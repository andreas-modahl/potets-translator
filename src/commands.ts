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
              { name: 'Repost under the author name (webhook)', value: 'webhook' },
              { name: 'Reply to the message', value: 'reply' },
            ),
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

      const mode = (interaction.options.getString('mode') as PostMode | null) ?? config.defaultPostMode;
      await store.set(channelId, { targets, mode });
      await reply(
        interaction,
        `Translating every message in this channel into ${targets.map(labelFor).join(', ')}.\n` +
          `Messages already in a target language are left alone. Posting mode: **${mode}**.`,
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
          ? `Translating into ${settings.targets.map(labelFor).join(', ')} — posting mode **${settings.mode}**.`
          : 'Translation is off in this channel. Turn it on with `/translator enable`.',
      );
      return;
    }
  }
}

function reply(interaction: ChatInputCommandInteraction, content: string): Promise<unknown> {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
