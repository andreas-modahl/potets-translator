import {
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { PostMode } from './config.js';
import { config } from './config.js';
import { labelFor, parseTargets } from './languages.js';
import type { ChannelStore } from './store.js';

export const commandData = [
  new SlashCommandBuilder()
    .setName('translator')
    .setDescription('Configure automatic translation for a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Translate every message in this channel')
        .addStringOption((option) =>
          option
            .setName('languages')
            .setDescription('Comma-separated target languages, e.g. "English, Norwegian"')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('How translations are posted')
            .addChoices(
              { name: 'A plain message in the channel', value: 'plain' },
              { name: 'In a thread under the message', value: 'thread' },
              { name: 'Reply to the message', value: 'reply' },
              { name: 'Repost under the author name (webhook)', value: 'webhook' },
            ),
        )
        .addBooleanOption((option) =>
          option
            .setName('explain')
            .setDescription('Add a word-by-word breakdown back to the original wording'),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('disable').setDescription('Stop translating this channel'),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show this channel’s translation settings'),
    )
    .toJSON(),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  store: ChannelStore,
): Promise<void> {
  if (interaction.commandName !== 'translator') return;
  const channelId = interaction.channelId;

  switch (interaction.options.getSubcommand()) {
    case 'enable': {
      const targets = parseTargets(interaction.options.getString('languages', true));
      if (targets.length === 0) {
        await reply(interaction, 'Give me at least one target language, e.g. `English, Norwegian`.');
        return;
      }
      if (targets.length > 5) {
        await reply(
          interaction,
          `That is ${targets.length} target languages. Cap is 5 — every extra language is another translation of every message.`,
        );
        return;
      }

      // Recorded only when explicitly chosen, so an unspecified channel keeps
      // following DEFAULT_POST_MODE rather than freezing today's default.
      const chosen = interaction.options.getString('mode') as PostMode | null;
      const explain = interaction.options.getBoolean('explain');
      await store.set(channelId, {
        targets,
        ...(chosen ? { mode: chosen } : {}),
        ...(explain === null ? {} : { explain }),
      });

      const effective = chosen ?? config.defaultPostMode;
      await reply(
        interaction,
        `Translating every message in this channel into ${targets.map(labelFor).join(', ')}.\n` +
          `Messages already in a target language are left alone. Posting mode: **${effective}**` +
          `${chosen ? '' : ' (following the server default)'}.\n` +
          `Explanations: **${(explain ?? config.explainByDefault) ? 'on' : 'off'}**` +
          `${explain === null ? ' (following the server default)' : ''}.`,
      );
      return;
    }

    case 'disable': {
      const removed = await store.delete(channelId);
      await reply(
        interaction,
        removed ? 'Stopped translating this channel.' : 'This channel was not being translated.',
      );
      return;
    }

    case 'status': {
      const settings = store.get(channelId);
      await reply(
        interaction,
        settings
          ? `Translating into ${settings.targets.map(labelFor).join(', ')} — posting mode ` +
            `**${settings.mode ?? config.defaultPostMode}**` +
            `${settings.mode ? ' (set for this channel)' : ' (following the server default)'}, ` +
            `explanations **${(settings.explain ?? config.explainByDefault) ? 'on' : 'off'}**` +
            `${settings.explain === undefined ? ' (following the server default)' : ''}.`
          : 'Translation is off in this channel. Turn it on with `/translator enable`.',
      );
      return;
    }
  }
}

function reply(interaction: ChatInputCommandInteraction, content: string): Promise<unknown> {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
