import {
  type Client,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type Webhook,
} from 'discord.js';
import type { PostMode } from './config.js';
import { highlight } from './highlight.js';
import { interlinear } from './interlinear.js';
import { flagFor } from './languages.js';
import type { Translation } from './translate.js';

const WEBHOOK_NAME = 'Potets Translator';
const DISCORD_MESSAGE_LIMIT = 2000;
/** Between a translated chunk and the original it came from. */
const GAP = '  ';
/** Between one pair and the next, wider so the pairs read as separate units. */
const BREAK = '     ';
/** How many original -> translation links are remembered for edit and delete sync. */
const MAX_TRACKED = 1000;

/** Never let a translation ping anyone: the original message already did. */
const NO_PINGS = { parse: [] as never[], repliedUser: false };

/**
 * Sends translations the way an "@silent" message goes out: no push notification
 * and no unread badge bump. The message being translated already notified
 * everyone, and notifying a second time for the same content is pure noise.
 */
const SILENT = MessageFlags.SuppressNotifications;

interface PostedRef {
  postedId: string;
  viaWebhook: boolean;
  hostChannelId: string;
  threadId?: string;
}

/**
 * Renders translations as a single message, one line per language, so a channel
 * with three targets does not get three separate posts per message.
 *
 * Kept deliberately bare: the reply already quotes the original above it, so a
 * flag is enough to say which language this is. Spelling out the name, bolding
 * it, or adding a separator only repeats what the reader can already see.
 */
function render(translations: Translation[]): string {
  const body = translations
    .map(({ text, gloss, glossStyle }) => {
      // Reads as the translated sentence with the original tucked in after each
      // piece, rather than as a list of equations to cross-reference. Discord
      // preserves runs of spaces, so whitespace does the separating that
      // punctuation and styling were doing before.
      const pairs = gloss?.length
        ? gloss.map(({ target, source }) => `${tidy(target)}${GAP}(${tidy(source)})`).join(BREAK)
        : '';

      // A full breakdown lays the original above the translation in aligned
      // columns, which needs a code block to hold the alignment. A beginner one
      // covers only a few words, so the sentence stays, with those words marked.
      const stacked = glossStyle === 'full' && gloss?.length ? interlinear(gloss) : '';
      if (stacked) return fence(stacked);

      const content =
        glossStyle === 'beginner' && gloss?.length
          ? highlight(text, gloss.map(({ target }) => target))
          : text;

      return glossStyle === 'beginner' && pairs ? `${content}\n${pairs}` : content;
    })
    .join('\n');

  return body.length > DISCORD_MESSAGE_LIMIT
    ? `${body.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`
    : body;
}

/**
 * Names the thread with just the target language's flag.
 *
 * Discord's thread box already previews the newest message inside the thread,
 * so anything more in the name only repeats what is shown directly below it.
 * A language with no flag falls back to its name, since a nameless thread is
 * worse than a wordy one.
 */
function threadName(translations: Translation[]): string {
  const name = translations
    .map(({ language }) => flagFor(language) ?? language)
    .join(' ');
  if (!name) return 'Translation';
  // Discord caps thread names at 100 characters.
  return name.length > 100 ? `${name.slice(0, 99)}…` : name;
}

/**
 * Wraps text in a fenced block, which is the only way to get the fixed-width
 * font the column alignment depends on.
 */
function fence(text: string): string {
  // A fence inside the text would close the block early and spill the rest.
  return `\`\`\`\n${text.replace(/```/gu, "'''")}\n\`\`\``;
}

/** Collapses any internal whitespace, so the deliberate spacing is the only spacing. */
function tidy(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Discord rejects webhook usernames containing "discord" or "clyde". */
function safeUsername(message: Message): string {
  const raw = message.member?.displayName ?? message.author.displayName ?? message.author.username;
  const cleaned = raw.replace(/discord/giu, 'disc0rd').replace(/clyde/giu, 'clyd3').slice(0, 80);
  return cleaned.trim() || 'Translator';
}

/**
 * Posts translations back to the channel and keeps them in sync when the
 * original message is edited or deleted.
 */
export class Poster {
  private readonly webhooks = new Map<string, Webhook>();
  private readonly tracked = new Map<string, PostedRef>();

  constructor(private readonly client: Client) {}

  async post(message: Message, translations: Translation[], mode: PostMode): Promise<void> {
    if (translations.length === 0) return;

    if (mode === 'thread') {
      if (await this.postInThread(message, translations)) return;
      // Threads are unavailable here — no permission, or already inside one.
      // A reply is the closest thing that always works.
    }

    const content = render(translations);

    if (mode === 'plain' && message.channel.isSendable()) {
      const sent = await message.channel.send({
        content,
        allowedMentions: NO_PINGS,
        flags: SILENT,
      });
      this.track(message.id, {
        postedId: sent.id,
        viaWebhook: false,
        hostChannelId: message.channelId,
      });
      return;
    }

    if (mode === 'webhook') {
      const target = await this.resolveWebhook(message).catch(() => null);
      if (target) {
        const sent = await target.webhook.send({
          content,
          username: safeUsername(message),
          avatarURL: message.author.displayAvatarURL(),
          allowedMentions: NO_PINGS,
          flags: SILENT,
          ...(target.threadId ? { threadId: target.threadId } : {}),
        });
        this.track(message.id, {
          postedId: sent.id,
          viaWebhook: true,
          hostChannelId: target.webhook.channelId,
          ...(target.threadId ? { threadId: target.threadId } : {}),
        });
        return;
      }
      // No Manage Webhooks permission, or webhook creation failed. A reply is
      // less pretty but always available.
    }

    const sent = await message.reply({ content, allowedMentions: NO_PINGS, flags: SILENT });
    this.track(message.id, {
      postedId: sent.id,
      viaWebhook: false,
      hostChannelId: message.channelId,
    });
  }

  /** Rewrites an existing translation after the original message was edited. */
  async update(originalId: string, translations: Translation[]): Promise<boolean> {
    const ref = this.tracked.get(originalId);
    if (!ref) return false;
    const content = render(translations);

    if (ref.viaWebhook) {
      const webhook = this.webhooks.get(ref.hostChannelId);
      if (!webhook) return false;
      await webhook.editMessage(ref.postedId, {
        content,
        allowedMentions: NO_PINGS,
        ...(ref.threadId ? { threadId: ref.threadId } : {}),
      });
      return true;
    }

    const channel = await this.client.channels.fetch(ref.threadId ?? ref.hostChannelId);
    if (!channel?.isTextBased()) return false;
    const posted = await channel.messages.fetch(ref.postedId);
    await posted.edit({ content, allowedMentions: NO_PINGS });
    return true;
  }

  /**
   * Removes a translation whose original message was deleted.
   *
   * Failures are swallowed: in thread mode Discord deletes the thread along
   * with the message it hangs off, so the translation is usually already gone
   * by the time this runs.
   */
  async remove(originalId: string): Promise<void> {
    const ref = this.tracked.get(originalId);
    if (!ref) return;
    this.tracked.delete(originalId);

    try {
      if (ref.viaWebhook) {
        const webhook = this.webhooks.get(ref.hostChannelId);
        await webhook?.deleteMessage(ref.postedId, ref.threadId);
        return;
      }

      const channel = await this.client.channels.fetch(ref.threadId ?? ref.hostChannelId);
      if (!channel?.isTextBased()) return;
      await channel.messages.delete(ref.postedId);
    } catch {
      // Already gone, which is the desired end state anyway.
    }
  }

  knows(originalId: string): boolean {
    return this.tracked.has(originalId);
  }

  private track(originalId: string, ref: PostedRef): void {
    this.tracked.set(originalId, ref);
    while (this.tracked.size > MAX_TRACKED) {
      const oldest = this.tracked.keys().next();
      if (oldest.done) break;
      this.tracked.delete(oldest.value);
    }
  }

  /**
   * Posts the translation into a thread hanging off the original message.
   * Returns false when that is not possible, so the caller can fall back.
   */
  private async postInThread(message: Message, translations: Translation[]): Promise<boolean> {
    // Threads exist only in guilds, and Discord has no nested threads, so a
    // message already inside one cannot start another.
    if (!message.inGuild() || message.channel.isThread()) return false;

    const me = message.guild.members.me;
    const permissions = me && message.channel.permissionsFor(me);
    if (
      !permissions?.has(PermissionFlagsBits.CreatePublicThreads) ||
      !permissions.has(PermissionFlagsBits.SendMessagesInThreads)
    ) {
      return false;
    }

    try {
      const thread =
        message.thread ??
        (await message.startThread({
          name: threadName(translations),
          // Translations get read straight away. Archiving them quickly keeps
          // the active thread list clean and stays well clear of the per-guild
          // active thread cap; an archived thread is still readable, and any
          // reply in it brings it back.
          autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
        }));

      const content = render(translations);
      const sent = await thread.send({ content, allowedMentions: NO_PINGS, flags: SILENT });
      this.track(message.id, {
        postedId: sent.id,
        viaWebhook: false,
        hostChannelId: thread.id,
      });
      return true;
    } catch (error) {
      console.error(`Could not post translation in a thread for ${message.id}:`, error);
      return false;
    }
  }

  private async resolveWebhook(
    message: Message,
  ): Promise<{ webhook: Webhook; threadId?: string } | null> {
    const channel = message.channel;
    const inThread = channel.isThread();
    const host = inThread ? channel.parent : channel;
    if (!host || !('fetchWebhooks' in host)) return null;

    const threadId = inThread ? channel.id : undefined;
    const cached = this.webhooks.get(host.id);
    if (cached) return { webhook: cached, ...(threadId ? { threadId } : {}) };

    const me = message.guild?.members.me;
    if (!me || !host.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) return null;

    const existing = await host.fetchWebhooks();
    const mine = existing.find(
      (hook) => hook.owner?.id === this.client.user?.id && hook.token !== null,
    );
    const webhook =
      mine ??
      (await host.createWebhook({
        name: WEBHOOK_NAME,
        reason: 'Posting translations under the original author name',
      }));

    this.webhooks.set(host.id, webhook);
    return { webhook, ...(threadId ? { threadId } : {}) };
  }
}
