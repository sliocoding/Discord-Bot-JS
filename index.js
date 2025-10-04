const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot Discord đang hoạt động!');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});
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

// Warns: { guildId: { userId: count } }
let warns = {};

// ======= Helper: Kiểm tra quyền owner =======
function isOwner(user) {
  return user.id === OWNER_ID || user === OWNER_ID;
}

// ======= Helper: Kiểm tra quyền admin (owner luôn là admin) =======
function isAdmin(member) {
  if (!member) return false;
  if (isOwner(member.user)) return true;
  if (admins.has(member.id)) return true;
  if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return false;
}

// ======= MINIGAME ĐOÁN SỐ =======
let guessGame = null;

// ======= Helper: Mute Helper =======
async function muteMember(member, durationMs, message) {
  let mutedRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  if (!mutedRole) {
    try {
      mutedRole = await member.guild.roles.create({ name: "Muted", permissions: [] });
      // Remove send perms for all channels
      for (const channel of member.guild.channels.cache.values()) {
        await channel.permissionOverwrites.create(mutedRole, {
          SendMessages: false,
          AddReactions: false,
          Speak: false
        });
      }
    } catch (e) {
      return message.reply("Không tạo được role Muted: " + e.message);
    }
  }
  await member.roles.add(mutedRole);
  message.reply(`${member} đã bị mute${durationMs ? ` trong ${Math.floor(durationMs / 1000)} giây` : ''}.`);
  if (durationMs) {
    setTimeout(async () => {
      if (member.roles.cache.has(mutedRole.id)) {
        await member.roles.remove(mutedRole).catch(() => {});
        message.channel.send(`${member} đã được unmute tự động.`);
      }
    }, durationMs);
  }
}

// ======= Helper: Warn =======
function addWarn(guildId, userId) {
  if (!warns[guildId]) warns[guildId] = {};
  if (!warns[guildId][userId]) warns[guildId][userId] = 0;
  warns[guildId][userId]++;
  return warns[guildId][userId];
}

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

  // --- REMOVEADMIN ---
  if (cmd === 'removeadmin') {
    if (!isOwner(message.member)) return message.reply('Chỉ owner mới xóa quyền admin!');
    let member;
    if (args[0]?.startsWith('<@') && args[0].endsWith('>')) {
      const id = args[0].replace(/[<@!>]/g, '');
      member = await message.guild.members.fetch(id).catch(() => null);
    } else if (/^\d+$/.test(args[0])) {
      member = await message.guild.members.fetch(args[0]).catch(() => null);
    }
    if (!member) return message.reply('Không tìm thấy user.');
    admins.delete(member.id);
    message.reply(`Đã xóa quyền admin của ${member}.`);
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

  // === ADMIN: BAN ===
  if (cmd === 'ban') {
    if (!isAdmin(message.member)) return message.reply("Bạn không có quyền admin!");
    let member;
    if (args[0]?.startsWith('<@') && args[0].endsWith('>')) {
      const id = args[0].replace(/[<@!>]/g, '');
      member = await message.guild.members.fetch(id).catch(() => null);
    } else if (/^\d+$/.test(args[0])) {
      member = await message.guild.members.fetch(args[0]).catch(() => null);
    }
    if (!member) return message.reply('Không tìm thấy user.');
    if (isOwner(member.user)) return message.reply('Không thể ban owner!');
    const reason = args.slice(1).join(" ") || "Không ghi lý do";
    await member.ban({ reason }).catch(e => message.reply("Không ban được: " + e.message));
    message.reply(`Đã ban ${member.user.tag}. Lý do: ${reason}`);
  }

  // === ADMIN: MUTE ===
  if (cmd === 'mute') {
    if (!isAdmin(message.member)) return message.reply("Bạn không có quyền admin!");
    let member;
    if (args[0]?.startsWith('<@') && args[0].endsWith('>')) {
      const id = args[0].replace(/[<@!>]/g, '');
      member = await message.guild.members.fetch(id).catch(() => null);
    } else if (/^\d+$/.test(args[0])) {
      member = await message.guild.members.fetch(args[0]).catch(() => null);
    }
    if (!member) return message.reply('Không tìm thấy user.');
    if (isOwner(member.user)) return message.reply('Không thể mute owner!');
    let duration = 0;
    if (args[1]) {
      const timeMatch = args[1].match(/^(\d+)(s|m|h)?$/);
      if (timeMatch) {
        const val = parseInt(timeMatch[1]);
        const unit = timeMatch[2] || "s";
        duration = unit === "m" ? val * 60 * 1000 : unit === "h" ? val * 60 * 60 * 1000 : val * 1000;
      }
    }
    await muteMember(member, duration, message);
  }

  // === ADMIN: WARN ===
  if (cmd === 'warn') {
    if (!isAdmin(message.member)) return message.reply("Bạn không có quyền admin!");
    let member;
    if (args[0]?.startsWith('<@') && args[0].endsWith('>')) {
      const id = args[0].replace(/[<@!>]/g, '');
      member = await message.guild.members.fetch(id).catch(() => null);
    } else if (/^\d+$/.test(args[0])) {
      member = await message.guild.members.fetch(args[0]).catch(() => null);
    }
    if (!member) return message.reply('Không tìm thấy user.');
    if (isOwner(member.user)) return message.reply('Không thể warn owner!');
    const reason = args.slice(1).join(" ") || "Không ghi lý do";
    const count = addWarn(message.guild.id, member.id);
    message.reply(`${member} đã bị cảnh cáo. Lý do: ${reason}. Số lần warn: ${count}`);
    // Tự động mute/ban nếu warn quá 3 lần
    if (count >= 3) {
      await muteMember(member, 5 * 60 * 1000, message); // Mute 5 phút
      message.channel.send(`${member} đã bị mute tự động do bị warn quá 3 lần.`);
    }
  }

  // === OWNER: SHUTDOWN ===
  if (cmd === 'shutdown') {
    if (!isOwner(message.author)) return message.reply("Chỉ owner mới được tắt bot!");
    message.reply("Đang tắt bot...");
    setTimeout(() => process.exit(0), 1500);
  }

});

client.once('ready', () => {
  console.log(`Bot đã đăng nhập với tên: ${client.user.tag}`);
});

client.login(process.env.TOKEN);
// ... [phần code phía trên giữ nguyên như trước]

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX) && !message.content.startsWith('!help')) return;

  const args = message.content
    .replace(/^!help/, '?help') // Cho phép !help hoạt động như ?help
    .slice(PREFIX.length)
    .trim()
    .split(/ +/);
  const cmd = args.shift()?.toLowerCase() || '';

  // === LỆNH HELP CHO MỌI NGƯỜI ===
  if (cmd === 'help') {
    return message.channel.send(
      `**Các lệnh cơ bản:**\n`
      + `- \`?help\` hoặc \`!help\`: Xem hướng dẫn cơ bản\n`
      + `- \`?lb\`: Xem bảng xếp hạng minigame\n`
      + `- \`?guess\`: Chơi đoán số\n`
      + `- \`?ppt kéo/búa/bao\`: Oẳn tù tì với bot\n`
      + `- \`?adcmd\`: Lệnh cho admin\n`
      + `- \`?ownercmd\`: Lệnh cho owner\n`
      + `- Liên hệ admin nếu cần hỗ trợ thêm.\n`
      + `_Dùng \`?cmd\` (chỉ owner) để xem toàn bộ lệnh nâng cao!_`
    );
  }

  // === LỆNH CMD CHỈ OWNER XEM FULL COMMAND ===
  if (cmd === 'cmd') {
    if (!isOwner(message.author)) return message.reply('Chỉ owner mới dùng được lệnh này!');
    return message.channel.send(
      `**Danh sách lệnh đầy đủ:**\n`
      + `- \`?help\` hoặc \`!help\`: Xem hướng dẫn\n`
      + `- \`?lb\`: Bảng xếp hạng minigame\n`
      + `- \`?guess\`: Đoán số\n`
      + `- \`?ppt kéo/búa/bao\`: Oẳn tù tì\n`
      + `- \`?adcmd\`: Lệnh admin (test)\n`
      + `- \`?ownercmd\`: Lệnh owner (test)\n`
      + `- \`?giveadmin @user|ID\`: Owner cấp quyền admin\n`
      + `- \`?removeadmin @user|ID\`: Owner xóa quyền admin\n`
      + `- \`?setadminroleid ROLE_ID\`: Owner set role admin\n`
      + `- \`?ban @user|ID lý do\`: Admin ban user\n`
      + `- \`?mute @user|ID [thời gian]\`: Admin mute user (10s, 2m, 1h...)\n`
      + `- \`?warn @user|ID lý do\`: Admin cảnh cáo, 3 warn auto mute 5 phút\n`
      + `- \`?shutdown\`: Owner tắt bot\n`
      + `- _Có thể cập nhật thêm các lệnh khác trong tương lai._`
    );
  }

  // ... [phần code các lệnh khác giữ nguyên như trước]
});
let isShutdown = false;

client.on('messageCreate', async (message) => {
  if (isShutdown && message.content !== '?startup') return;

  // ... các lệnh khác giữ nguyên

  if (cmd === 'shutdown') {
    if (!isOwner(message.author)) return message.reply("Chỉ owner mới được tắt bot!");
    isShutdown = true;
    return message.reply("Bot đã vào trạng thái tạm dừng. Gõ `?startup` để bật lại.");
  }

  if (cmd === 'startup') {
    if (!isOwner(message.author)) return;
    isShutdown = false;
    return message.reply("Bot đã hoạt động lại!");
  }

  // ... các lệnh khác
});
