import { Client, Events, GatewayIntentBits, type Message, MessageFlags } from 'discord.js';
import { commandData, handleCommand } from './commands.js';
import { assertConfigured, config } from './config.js';
import { inspect } from './filter.js';
import { Limiter } from './limiter.js';
import { Poster } from './poster.js';
import { ChannelStore } from './store.js';
import { translate } from './translate.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Privileged: enable "Message Content Intent" on the bot's page in the
    // Discord developer portal, or every message arrives with empty content.
    GatewayIntentBits.MessageContent,
  ],
});

const store = new ChannelStore(config.dataFile);
const poster = new Poster(client);
const limiter = new Limiter(5);

client.once(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.tag} using model ${config.model}.`);
  try {
    if (config.guildId) {
      const guild = await ready.guilds.fetch(config.guildId);
      await guild.commands.set(commandData);
      console.log(`Registered slash commands to guild ${guild.name}.`);
    } else {
      await ready.application.commands.set(commandData);
      console.log('Registered slash commands globally (may take up to an hour to appear).');
    }
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction, store);
  } catch (error) {
    console.error('Command failed:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: 'Something went wrong running that command.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  const settings = store.get(message.channelId);
  if (!settings) return;

  const verdict = inspect(message, config.maxInputChars);
  if (!verdict.translate) {
    if (verdict.reason === 'too-long') {
      console.log(`Skipped a ${message.content.length} character message in #${message.channelId}.`);
    }
    return;
  }

  await limiter.run(async () => {
    try {
      if (message.channel.isTextBased() && 'sendTyping' in message.channel) {
        await message.channel.sendTyping().catch(() => undefined);
      }
      const result = await translate(verdict.text, settings.targets);
      if (result.translations.length === 0) return;
      await poster.post(message, result.translations, settings.mode);
    } catch (error) {
      console.error(`Translation failed for message ${message.id}:`, error);
    }
  });
});

client.on(Events.MessageUpdate, async (before, updated) => {
  if (!poster.knows(updated.id)) return;
  // Discord fires an update when it finishes unfurling a link into an embed.
  // The text is untouched there, so there is nothing to re-translate.
  if (before.content !== null && before.content === updated.content) return;

  try {
    const message: Message = updated.partial ? await updated.fetch() : (updated as Message);
    const settings = store.get(message.channelId);
    if (!settings) return;

    const verdict = inspect(message, config.maxInputChars);
    if (!verdict.translate) {
      // The edit removed everything translatable, so drop the stale translation.
      await poster.remove(message.id);
      return;
    }

    const result = await limiter.run(() => translate(verdict.text, settings.targets));
    if (result.translations.length === 0) {
      await poster.remove(message.id);
      return;
    }
    await poster.update(message.id, result.translations);
  } catch (error) {
    console.error(`Failed to update translation for ${updated.id}:`, error);
  }
});

client.on(Events.MessageDelete, async (message) => {
  try {
    await poster.remove(message.id);
  } catch (error) {
    console.error(`Failed to delete translation for ${message.id}:`, error);
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error));

async function main(): Promise<void> {
  assertConfigured();
  await store.load();
  await client.login(config.discordToken);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, shutting down.`);
    void client.destroy().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
