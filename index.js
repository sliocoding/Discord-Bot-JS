require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const express = require('express');
const OpenAI = require('openai');

// === WEB SERVER ===
const app = express();
app.get('/', (req, res) => res.send('✅ Bot đang chạy!'));
app.listen(10000, () => console.log('🌐 Web server running on port 10000'));

// === CLIENT ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const PREFIX = '?';
const OWNER_ID = process.env.OWNER_ID;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === LOAD DỮ LIỆU ===
const dataPath = path.join(__dirname, 'data.json');
let data = { balances: {}, warns: {}, stocks: { AAPL: 100, TSLA: 120, GME: 80 } };

if (fs.existsSync(dataPath)) {
  try {
    data = JSON.parse(fs.readFileSync(dataPath));
    console.log('📂 Dữ liệu đã được tải.');
  } catch (e) {
    console.error('⚠️ Lỗi đọc data.json, tạo mới...');
  }
}

function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

// === BOT READY ===
client.once('ready', () => console.log(`✅ Bot đăng nhập: ${client.user.tag}`));

// === MESSAGE HANDLER ===
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // === BASIC ===
  if (cmd === 'ping') return message.reply(`🏓 Ping: ${client.ws.ping}ms`);
  if (cmd === 'bal') return message.reply(`💰 Bạn có **${data.balances[message.author.id] || 0} Skibidi Coin**`);
  if (cmd === 'hourly') {
    data.balances[message.author.id] = (data.balances[message.author.id] || 0) + 50;
    saveData();
    message.reply('💸 Nhận **50 Skibidi Coin!**');
  }

  // === GAME ===
  if (cmd === 'guess') {
    const num = Math.floor(Math.random() * 100) + 1;
    message.reply('🎯 Tôi đã nghĩ 1 số (1-100). Đoán đi!');
    const collector = message.channel.createMessageCollector({ time: 30000 });
    collector.on('collect', (m) => {
      if (m.author.bot || isNaN(m.content)) return;
      const guess = parseInt(m.content);
      if (guess === num) {
        m.reply(`🎉 Chính xác! Số là ${num}`);
        data.balances[m.author.id] = (data.balances[m.author.id] || 0) + 100;
        saveData();
        collector.stop();
      } else if (guess < num) m.reply('🔼 Lớn hơn!');
      else m.reply('🔽 Nhỏ hơn!');
    });
    collector.on('end', () => message.channel.send(`⏱ Hết giờ! Số đúng: ${num}`));
  }

  if (cmd === 'cf') {
    const side = args[0]?.toLowerCase();
    const bet = parseInt(args[1]);
    if (!['heads', 'tails'].includes(side) || isNaN(bet))
      return message.reply('Cú pháp: `?cf heads|tails <số>`');
    if ((data.balances[message.author.id] || 0) < bet) return message.reply('Không đủ coin!');
    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    if (flip === side) {
      data.balances[message.author.id] += bet;
      message.reply(`🪙 Ra **${flip}**, bạn thắng +${bet}!`);
    } else {
      data.balances[message.author.id] -= bet;
      message.reply(`🪙 Ra **${flip}**, bạn thua -${bet}!`);
    }
    saveData();
  }

  if (cmd === 'race') {
    const horses = ['🐎1', '🐎2', '🐎3', '🐎4'];
    const msg = await message.channel.send('🏁 Bắt đầu đua!');
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
          message.channel.send(`🏆 ${h} thắng cuộc!`);
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
    if (!data.stocks[symbol]) return message.reply('Mã không hợp lệ!');
    const change = Math.floor(Math.random() * 21) - 10;
    data.stocks[symbol] += change;
    saveData();
    message.reply(`💹 ${symbol}: ${change > 0 ? '+' : ''}${change} → ${data.stocks[symbol]}`);
  }

  // === ADMIN ===
  if (cmd === 'adcmd') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('🚫 Không có quyền!');
    const sub = args.shift();
    const user = message.mentions.members.first();

    if (sub === 'ban' && user) return user.ban() && message.reply('🚨 Đã ban!');
    if (sub === 'mute' && user) {
      await user.timeout(600000, 'Muted 10 phút');
      return message.reply('🔇 Đã mute 10 phút!');
    }
    if (sub === 'warn' && user) {
      data.warns[user.id] = (data.warns[user.id] || 0) + 1;
      saveData();
      return message.reply(`⚠️ Cảnh cáo ${user.user.tag} (${data.warns[user.id]} lần)`);
    }
    if (sub === 'editbal' && user && args[0]) {
      data.balances[user.id] = parseInt(args[0]);
      saveData();
      return message.reply(`💵 Sửa coin cho ${user.user.tag}`);
    }
  }

  // === OWNER ===
  if (cmd === 'owncmd') {
    if (message.author.id !== OWNER_ID) return message.reply('🚫 Chỉ owner!');
    const sub = args.shift();
    if (sub === 'shutdown') {
      await message.reply('💤 Tắt bot...');
      saveData();
      process.exit();
    }
    if (sub === 'say') return message.channel.send(args.join(' '));
    if (sub === 'eval') {
      try {
        const res = eval(args.join(' '));
        message.reply(`✅ Kết quả:\n\`\`\`${res}\`\`\``);
      } catch (e) {
        message.reply(`❌ ${e}`);
      }
    }
  }

  // === CHATGPT ===
  if (cmd === 'ask') {
    const prompt = args.join(' ');
    if (!prompt) return message.reply('Nhập nội dung để hỏi!');
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
      });
      message.reply(completion.choices[0].message.content);
    } catch (e) {
      message.reply('❌ Lỗi gọi GPT: ' + e.message);
    }
  }

  // === HELP ===
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📜 Danh sách lệnh Skibidi Bot')
      .setColor('Aqua')
      .addFields(
        { name: '🎮 Game', value: '`?guess`, `?cf`, `?race`, `?stock`' },
        { name: '💰 Tiền tệ', value: '`?bal`, `?hourly`' },
        { name: '⚙️ Admin', value: '`?adcmd ban|mute|warn|editbal`' },
        { name: '👑 Owner', value: '`?owncmd shutdown|say|eval`' },
        { name: '🤖 Khác', value: '`?ping`, `?ask`, `?help`' }
      )
      .setFooter({ text: 'Skibidi Bot by shimano20' });
    message.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);
