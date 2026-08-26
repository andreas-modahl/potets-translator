import { type Client, type Message, PermissionFlagsBits, type Webhook } from 'discord.js';
import type { PostMode } from './config.js';
import { labelFor } from './languages.js';
import type { Translation } from './translate.js';

const WEBHOOK_NAME = 'Potets Translator';
const DISCORD_MESSAGE_LIMIT = 2000;
/** How many original -> translation links are remembered for edit and delete sync. */
const MAX_TRACKED = 1000;

/** Never let a translation ping anyone: the original message already did. */
const NO_PINGS = { parse: [] as never[], repliedUser: false };

interface PostedRef {
  postedId: string;
  viaWebhook: boolean;
  hostChannelId: string;
  threadId?: string;
}

/**
 * Renders translations as a single message, one line per language, so a channel
 * with three targets does not get three separate posts per message.
 */
function render(translations: Translation[]): string {
  const body = translations
    .map(({ language, text }) => {
      const label = labelFor(language);
      // Multi-line translations get the label on its own line so the text keeps
      // its original shape.
      return text.includes('\n') ? `**${label}**\n${text}` : `${label} — ${text}`;
    })
    .join('\n');

  return body.length > DISCORD_MESSAGE_LIMIT
    ? `${body.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`
    : body;
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
    const content = render(translations);

    if (mode === 'webhook') {
      const target = await this.resolveWebhook(message).catch(() => null);
      if (target) {
        const sent = await target.webhook.send({
          content,
          username: safeUsername(message),
          avatarURL: message.author.displayAvatarURL(),
          allowedMentions: NO_PINGS,
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

    const sent = await message.reply({ content, allowedMentions: NO_PINGS });
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

  /** Removes a translation whose original message was deleted. */
  async remove(originalId: string): Promise<void> {
    const ref = this.tracked.get(originalId);
    if (!ref) return;
    this.tracked.delete(originalId);

    if (ref.viaWebhook) {
      const webhook = this.webhooks.get(ref.hostChannelId);
      await webhook?.deleteMessage(ref.postedId, ref.threadId);
      return;
    }

    const channel = await this.client.channels.fetch(ref.threadId ?? ref.hostChannelId);
    if (!channel?.isTextBased()) return;
    await channel.messages.delete(ref.postedId);
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
