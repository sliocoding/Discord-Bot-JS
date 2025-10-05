require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const OpenAI = require('openai');
const NodeCache = require('node-cache');

// === WEB SERVER ===
const app = express();
app.get('/', (req, res) => res.send('✅ Bot đang chạy!'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// === CLIENT ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const PREFIX = '?';
const OWNER_ID = process.env.OWNER_ID;
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// OpenAI setup with error handling
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn('⚠️ Có OpenAI API Key đâu mà bắt t trả lời?');
}

// === COOLDOWN & RATE LIMITING ===
const cooldowns = new NodeCache({ stdTTL: 3600 }); // 1 hour cooldown
const apiRateLimit = new NodeCache({ stdTTL: 60 }); // 1 minute rate limit

// === LOAD DỮ LIỆU ===
const dataPath = path.join(__dirname, 'data.json');
let data = { balances: {}, warns: {}, stocks: { AAPL: 100, TSLA: 120, GME: 80 } };

// Data save queue to prevent race conditions
let saveQueue = Promise.resolve();

if (fs.existsSync(dataPath)) {
  try {
    data = JSON.parse(fs.readFileSync(dataPath));
    console.log('📂 Dữ liệu đã được tải.');
  } catch (e) {
    console.error('⚠️ Lỗi đọc data.json, tạo mới...', e.message);
  }
}

function saveData() {
  saveQueue = saveQueue.then(() => {
    return new Promise((resolve) => {
      fs.writeFile(dataPath, JSON.stringify(data, null, 2), (err) => {
        if (err) console.error('❌ Lỗi lưu data:', err.message);
        resolve();
      });
    });
  });
  return saveQueue;
}

// === UTILITY FUNCTIONS ===
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

// === SLASH COMMANDS SETUP ===
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra độ trễ của bot'),
  new SlashCommandBuilder()
    .setName('bal')
    .setDescription('Xem số dư Skibidi Coin của bạn'),
  new SlashCommandBuilder()
    .setName('hourly')
    .setDescription('Nhận 50 Skibidi Coin mỗi giờ'),
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Hỏi ChatGPT')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Câu hỏi của bạn')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hiển thị danh sách lệnh'),
].map(command => command.toJSON());

// Register slash commands
async function registerSlashCommands() {
  if (!CLIENT_ID || !TOKEN) {
    console.warn('⚠️ CLIENT_ID hoặc TOKEN không được cung cấp. Slash commands sẽ không được đăng ký.');
    return;
  }

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    console.log('🔄 Đang đăng ký slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands đã được đăng ký!');
  } catch (error) {
    console.error('❌ Lỗi đăng ký slash commands:', error.message);
  }
}

// === BOT READY ===
client.once('ready', async () => {
  console.log(`✅ Bot đăng nhập: ${client.user.tag}`);
  await registerSlashCommands();
});

// === SLASH COMMAND HANDLER ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  try {
    if (commandName === 'ping') {
      await interaction.reply(`🏓 Pong: ${client.ws.ping}ms`);
    }

    if (commandName === 'bal') {
      await interaction.reply(`💰 Ông con giời có **${data.balances[user.id] || 0} Skibidi Coin**`);
    }

    if (commandName === 'hourly') {
      const cooldownKey = `hourly_${user.id}`;
      const remaining = cooldowns.getTtl(cooldownKey);

      if (remaining) {
        const timeLeft = Math.floor((remaining - Date.now()) / 1000);
        return interaction.reply(`⏰ Ông con giời phải đợi thêm **${formatTime(timeLeft)}** nữa thì mới có coin!`);
      }

      data.balances[user.id] = (data.balances[user.id] || 0) + 50;
      cooldowns.set(cooldownKey, true);
      await saveData();
      await interaction.reply('💸 Lụm **50 Skibidi Coin!**');
    }

    if (commandName === 'ask') {
      if (!openai) {
        return interaction.reply('❌ OpenAI API chưa được cấu hình!');
      }

      const rateLimitKey = `ask_${user.id}`;
      const apiCount = apiRateLimit.get(rateLimitKey) || 0;

      if (apiCount >= 1000) {
        return interaction.reply('⏰ Cho t thở miếng được kh? Đợi 1 phút.');
      }

      const prompt = interaction.options.getString('question');
      await interaction.deferReply();

      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        });

        apiRateLimit.set(rateLimitKey, apiCount + 1, 60);
        await interaction.editReply(completion.choices[0].message.content);
      } catch (error) {
        await interaction.editReply(`❌ Lỗi gọi GPT: ${error.message}`);
      }
    }

    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📜 Danh sách lệnh Skibidi Bot')
        .setColor('Aqua')
        .addFields(
          { name: '🎮 Game', value: '`?guess`, `?cf`, `?race`, `?stock`' },
          { name: '💰 Tiền tệ', value: '`?bal`, `?hourly` hoặc `/bal`, `/hourly`' },
          { name: '⚙️ Admin', value: '`?adcmd ban|mute|warn|editbal`' },
          { name: '👑 Owner', value: '`?owncmd shutdown|say|eval`' },
          { name: '🤖 Khác', value: '`?ping`, `?ask`, `?help` hoặc `/ping`, `/ask`, `/help`' }
        )
        .setFooter({ text: 'Skibidi Bot by shimano20' });
      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`❌ Lỗi xử lý slash command ${commandName}:`, error.message);
    const errorMsg = `❌ Chạy đi các cháu ơi lỗi rồi: ${error.message}`;
    if (interaction.deferred) {
      await interaction.editReply(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
});

// === MESSAGE HANDLER (PREFIX COMMANDS) ===
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  try {
    // === BASIC ===
    if (cmd === 'ping') {
      return message.reply(`🏓 Pong: ${client.ws.ping}ms`);
    }

    if (cmd === 'bal') {
      return message.reply(`💰 Ông con giời có **${data.balances[message.author.id] || 0} Skibidi Coin**`);
    }

    if (cmd === 'hourly') {
      const cooldownKey = `hourly_${message.author.id}`;
      const remaining = cooldowns.getTtl(cooldownKey);

      if (remaining) {
        const timeLeft = Math.floor((remaining - Date.now()) / 1000);
        return message.reply(`⏰ Ông con giời phải đợi **${formatTime(timeLeft)}** nữa thì mới có coin!`);
      }

      data.balances[message.author.id] = (data.balances[message.author.id] || 0) + 50;
      cooldowns.set(cooldownKey, true);
      await saveData();
      return message.reply('💸 Lụm **50 Skibidi Coin!**');
    }

    // === GAME ===
    if (cmd === 'guess') {
      const num = Math.floor(Math.random() * 100) + 1;
      await message.reply('🎯 T đã nghĩ ra 1 số (1-100). Đoán đi các ông con giời!');
      const collector = message.channel.createMessageCollector({ time: 30000 });
      
      collector.on('collect', (m) => {
        if (m.author.bot || isNaN(m.content)) return;
        const guess = parseInt(m.content);
        
        if (guess === num) {
          m.reply(`🎉 Chính xác! Số là ${num}`);
          data.balances[m.author.id] = (data.balances[m.author.id] || 0) + 100;
          saveData();
          collector.stop();
        } else if (guess < num) {
          m.reply('🔼 Lớn hơn miếng nữa!');
        } else {
          m.reply('🔽 Nhỏ hơn miếng nữa!');
        }
      });
      
      collector.on('end', () => message.channel.send(`⏱ Hết giờ rồi các ông con giời,Số đúng là: ${num}`));
    }

    if (cmd === 'cf') {
      const side = args[0]?.toLowerCase();
      const bet = parseInt(args[1]);

      // Data validation
      if (!['heads', 'tails'].includes(side)) {
        return message.reply('❌ Dạ lệnh là: `?cf heads|tails <số>`');
      }

      if (isNaN(bet) || bet <= 0) {
        return message.reply('❌ M người âm hay gì mà chơi coin âm?');
      }

      if (bet > 1000000) {
        return message.reply('❌ Adu giàu v ba,nhưng mà đặt cược tối đa là 1,000,000 thôi ông con giời ạ!');
      }

      if ((data.balances[message.author.id] || 0) < bet) {
        return message.reply('❌ Hết coin mà bày đặt!');
      }

      const flip = Math.random() < 0.5 ? 'heads' : 'tails';
      
      if (flip === side) {
        data.balances[message.author.id] += bet;
        message.reply(`🪙 Ra **${flip}**, bạn thắng +${bet}!`);
      } else {
        data.balances[message.author.id] -= bet;
        message.reply(`🪙 Ra **${flip}**, bạn thua -${bet}!`);
      }
      
      await saveData();
    }

    if (cmd === 'race') {
      const horses = ['🐎1', '🐎2', '🐎3', '🐎4'];
      await message.channel.send('🏁 Bắt đầu đua!');
      let pos = [0, 0, 0, 0];
      let track = horses.map((h, i) => `${h} ${'—'.repeat(pos[i])}>`).join('\n');
      const board = await message.channel.send(`\`\`\`\n${track}\n\`\`\``);
      
      const interval = setInterval(() => {
        let finished = false;
        track = horses.map((h, i) => {
          pos[i] += Math.random() > 0.7 ? 1 : 0;
          if (pos[i] >= 10 && !finished) {
            finished = true;
            clearInterval(interval);
            message.channel.send(`🏆 ${h} win cmnr!`);
          }
          return `${h} ${'—'.repeat(pos[i])}>`;
        }).join('\n');
        board.edit(`\`\`\`\n${track}\n\`\`\``);
      }, 1000);
    }

    if (cmd === 'stock') {
      const symbol = args[0]?.toUpperCase();
      
      if (!symbol) {
        const list = Object.entries(data.stocks).map(([k, v]) => `${k}: ${v}💰`).join('\n');
        return message.reply(`📈 Giá cổ phiếu:\n${list}`);
      }

      // Data validation
      if (!/^[A-Z]{1,5}$/.test(symbol)) {
        return message.reply('❌ Mã cổ phiếu gì mà xàm quá vậy ba,nhớ là use (1-5 chữ cái)!');
      }

      if (!data.stocks[symbol]) {
        return message.reply('❌ Ủa có lệnh đó lun hả hay do t ngu ta? Dùng `?stock` để xem danh sách.');
      }

      const change = Math.floor(Math.random() * 21) - 10;
      data.stocks[symbol] += change;
      await saveData();
      message.reply(`💹 ${symbol}: ${change > 0 ? '+' : ''}${change} → ${data.stocks[symbol]}`);
    }

    // === ADMIN ===
    if (cmd === 'adcmd') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply('🚫 M có bị ngáo quyền lực không,m tưởng m là ai mà tao phải nghe lời m hả dog?');
      }

      const sub = args.shift();
      const user = message.mentions.members.first();

      if (!user) {
        return message.reply('❌ Dạ anh/chị hai pls mention user dùm em cái!');
      }

      try {
        if (sub === 'ban') {
          await user.ban({ reason: 'Banned by admin' });
          return message.reply(`🚨 Đã ban ${user.user.tag}!`);
        }

        if (sub === 'mute') {
          await user.timeout(600000, 'Muted 10 phút');
          return message.reply(`🔇 Đã mute ${user.user.tag} 10 phút!`);
        }

        if (sub === 'warn') {
          data.warns[user.id] = (data.warns[user.id] || 0) + 1;
          await saveData();
          return message.reply(`⚠️ Cảnh cáo ${user.user.tag} (${data.warns[user.id]} lần)`);
        }

        if (sub === 'editbal') {
          const amount = parseInt(args[0]);
          if (isNaN(amount)) {
            return message.reply('❌ Số tiền không hợp lệ!');
          }
          data.balances[user.id] = amount;
          await saveData();
          return message.reply(`💵 Sửa coin cho ${user.user.tag} → ${amount}`);
        }

        return message.reply('❌ Dạ ông/bà nội,cái lệnh ?help để cho chó ăn à,mình là admin thì thông minh dùm cái');
      } catch (error) {
        return message.reply(`❌ Lỗi: ${error.message}`);
      }
    }

    // === OWNER ===
    if (cmd === 'owncmd') {
      if (message.author.id !== OWNER_ID) {
        return message.reply('🚫 Ê ní,ní là cái thá gì mà bắt t phải nghe lệnh ní,bớt ảo tưởng mình là owner dùm cái');
      }

      const sub = args.shift();

      if (sub === 'shutdown') {
        await message.reply('💤 Tắt bot...');
        await saveData();
        process.exit();
      }

      if (sub === 'say') {
        if (args.length === 0) {
          return message.reply('❌ Nhập nội dung!');
        }
        return message.channel.send(args.join(' '));
      }

      if (sub === 'eval') {
        // Security: whitelist safe operations
        const code = args.join(' ');
        const dangerousPatterns = [
          /process\.env/i,
          /require\(/i,
          /import\s/i,
          /fs\./i,
          /child_process/i,
          /\.exit\(/i,
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(code)) {
            return message.reply('❌ Code chứa lệnh nguy hiểm!');
          }
        }

        try {
          let result = eval(code);
          result = JSON.stringify(result, null, 2);
          
          // Limit output to 1900 characters
          if (result.length > 1900) {
            result = result.substring(0, 1900) + '...';
          }
          
          message.reply(`✅ Kết quả:\n\`\`\`js\n${result}\n\`\`\``);
        } catch (e) {
          message.reply(`❌ Lỗi: ${e.message}`);
        }
      }
    }

    // === CHATGPT ===
    if (cmd === 'ask') {
      if (!openai) {
        return message.reply('❌ OpenAI API chưa được cấu hình!');
      }

      const rateLimitKey = `ask_${message.author.id}`;
      const apiCount = apiRateLimit.get(rateLimitKey) || 0;

      if (apiCount >= 1000) {
        return message.reply('⏰ Bạn đã hỏi quá nhiều! Đợi 1 phút.');
      }

      const prompt = args.join(' ');
      if (!prompt) {
        return message.reply('❌ Nhập nội dung để hỏi!');
      }

      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        });

        apiRateLimit.set(rateLimitKey, apiCount + 1, 60);
        message.reply(completion.choices[0].message.content);
      } catch (error) {
        message.reply(`❌ Lỗi gọi GPT: ${error.message}`);
      }
    }

    // === HELP ===
    if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📜 Danh sách lệnh Skibidi Bot')
        .setColor('Aqua')
        .addFields(
          { name: '🎮 Game', value: '`?guess`, `?cf`, `?race`, `?stock`' },
          { name: '💰 Tiền tệ', value: '`?bal`, `?hourly` hoặc `/bal`, `/hourly`' },
          { name: '⚙️ Admin', value: '`?adcmd ban|mute|warn|editbal`' },
          { name: '👑 Owner', value: '`?owncmd shutdown|say|eval`' },
          { name: '🤖 Khác', value: '`?ping`, `?ask`, `?help` hoặc `/ping`, `/ask`, `/help`' }
        )
        .setFooter({ text: 'Skibidi Bot - by shimano20' });
      message.channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`❌ Lỗi xử lý lệnh ${cmd}:`, error.message);
    message.reply(`❌ Đã xảy ra lỗi: ${error.message}`);
  }
});

// === ERROR HANDLING ===
client.on('error', (error) => {
  console.error('❌ Discord client error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error.message);
});

// === LOGIN ===
if (!TOKEN) {
  console.error('❌ TOKEN không được cung cấp! Bot không thể đăng nhập.');
  process.exit(1);
}

client.login(TOKEN).catch((error) => {
  console.error('❌ Lỗi đăng nhập:', error.message);
  process.exit(1);
});
