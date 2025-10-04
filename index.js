require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const PREFIX = "?";
const OWNER_ID = process.env.OWNER_ID; // Đặt ở biến môi trường .env
let ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || ""; // Đặt ở biến môi trường .env nếu muốn

// Lưu admin trong bộ nhớ (file/database thì nâng cấp sau)
let admins = new Set();

// Leaderboard điểm minigame (chỉ đơn giản, muốn lưu DB thì nâng cấp)
let leaderboard = {};

// ======= Helper: Kiểm tra quyền owner =======
function isOwner(user) {
  return user.id === OWNER_ID;
}

// ======= Helper: Kiểm tra quyền admin (owner luôn là admin) =======
function isAdmin(member) {
  if (isOwner(member.user)) return true;
  if (admins.has(member.id)) return true;
  if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return false;
}

// ======= MINIGAME ĐOÁN SỐ =======
let guessGame = null;

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // --- GIVEADMIN ---
  if (cmd === 'giveadmin') {
    if (!isOwner(message.member)) return message.reply('Chỉ owner mới cấp quyền admin!');
    let member;
    if (args[0]?.startsWith('<@') && args[0].endsWith('>')) {
      // mention
      const id = args[0].replace(/[<@!>]/g, '');
      member = await message.guild.members.fetch(id).catch(() => null);
    } else if (/^\d+$/.test(args[0])) {
      // ID
      member = await message.guild.members.fetch(args[0]).catch(() => null);
    }
    if (!member) return message.reply('Không tìm thấy user.');
    admins.add(member.id);
    message.reply(`Đã cấp quyền admin cho ${member}.`);
  }

  // --- SET ADMIN ROLE ID ---
  if (cmd === 'setadminroleid') {
    if (!isOwner(message.member)) return message.reply('Chỉ owner mới sửa role admin!');
    if (!args[0]) return message.reply('Dùng: ?setadminroleid <roleID>');
    ADMIN_ROLE_ID = args[0];
    message.reply(`Đã set ADMIN_ROLE_ID = ${ADMIN_ROLE_ID}`);
  }

  // --- LB ---
  if (cmd === 'lb') {
    let lbArray = Object.entries(leaderboard)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, point], i) => `#${i+1} <@${id}>: ${point} điểm`);
    if (!lbArray.length) lbArray = ["Chưa có ai chơi minigame!"];
    message.channel.send("**Bảng xếp hạng:**\n" + lbArray.join('\n'));
  }

  // --- MINIGAME ĐOÁN SỐ ---
  if (cmd === 'guess') {
    if (guessGame && guessGame.channelId === message.channel.id) {
      return message.reply('Đang có một game đoán số diễn ra ở kênh này rồi!');
    }
    const answer = Math.floor(Math.random() * 100) + 1;
    guessGame = { channelId: message.channel.id, answer };
    message.channel.send('Tôi đã nghĩ một số từ 1-100. Ai đoán đúng trước thì thắng! Gõ số bạn đoán.');

    const filter = m => !m.author.bot && m.channel.id === message.channel.id;
    const collector = message.channel.createMessageCollector({ filter, time: 60000 });

    collector.on('collect', m => {
      const guess = parseInt(m.content);
      if (isNaN(guess)) return;
      if (guess === guessGame.answer) {
        m.reply(`Chúc mừng! Bạn đã đoán đúng số **${guessGame.answer}**!`);
        leaderboard[m.author.id] = (leaderboard[m.author.id] || 0) + 5;
        guessGame = null;
        collector.stop();
      } else if (guess < guessGame.answer) {
        m.reply('Số lớn hơn!');
      } else {
        m.reply('Số nhỏ hơn!');
      }
    });

    collector.on('end', () => {
      if (guessGame) {
        message.channel.send(`Hết giờ! Số đúng là **${guessGame.answer}**`);
        guessGame = null;
      }
    });
  }

  // --- MINIGAME OẲN TÙ TÌ ---
  if (cmd === 'ppt') {
    if (!args[0]) return message.reply('Cú pháp: ?ppt kéo/búa/bao');
    const user = args[0].toLowerCase();
    if (!['kéo', 'búa', 'bao'].includes(user)) return message.reply('Chọn: kéo, búa hoặc bao');
    const botChoice = ['kéo', 'búa', 'bao'][Math.floor(Math.random() * 3)];
    let result = '';
    if (user === botChoice) result = 'Hòa!';
    else if (
      (user === 'kéo' && botChoice === 'bao') ||
      (user === 'búa' && botChoice === 'kéo') ||
      (user === 'bao' && botChoice === 'búa')
    ) {
      result = 'Bạn thắng!';
      leaderboard[message.author.id] = (leaderboard[message.author.id] || 0) + 2;
    }
    else result = 'Bạn thua!';
    message.reply(`Tôi chọn **${botChoice}**. ${result}`);
  }

  // --- ADMIN COMMAND (ví dụ) ---
  if (cmd === 'adcmd') {
    if (!isAdmin(message.member)) return message.reply('Bạn không có quyền admin!');
    message.reply('Lệnh admin đã chạy thành công!');
  }

  // --- OWNER COMMAND (ví dụ) ---
  if (cmd === 'ownercmd') {
    if (!isOwner(message.author)) return message.reply('Chỉ owner mới chạy được!');
    message.reply('Lệnh owner đã chạy thành công!');
  }
});

// ====== Ready ======
client.once('ready', () => {
  console.log(`Bot đã đăng nhập với tên: ${client.user.tag}`);
});

client.login(process.env.TOKEN);
