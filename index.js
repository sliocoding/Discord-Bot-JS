// bot.js — Full-featured Discord bot (Node.js)
// Requires: node >=16+, packages: discord.js, express, dotenv, openai
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const OpenAI = require('openai');

// ===== CONFIG =====
const DATA_FILE = path.join(__dirname, 'bot_data.json');
const PREFIX = '?';
const TOKEN = process.env.TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const OPENAI_KEY = process.env.OPENAI_API_KEY || null;
const PORT = process.env.PORT || 8080;

// ===== INIT OPENAI =====
let openai = null;
if (OPENAI_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_KEY });
}

// ===== KEEP-ALIVE (Express) =====
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));

// ===== DISCORD CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
});

// ===== DATA STORAGE =====
const defaultData = {
  coins: {},        // userId -> coins (int)
  hourly: {},       // userId -> iso datetime
  quiz: {},         // guildId -> quiz session
  bets: {},         // guildId -> race session
  stocks: {},       // symbol -> price
  portfolio: {},    // userId -> { symbol: qty }
  warns: {},        // userId -> [ {by, reason, time} ]
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read data file, resetting:', e);
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
}
let data = loadData();

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('saveData error:', e);
  }
}

// ===== HELPERS =====
function getCoins(userId) {
  return parseInt(data.coins[String(userId)] || 0);
}
function setCoins(userId, amount) {
  data.coins[String(userId)] = parseInt(amount);
  saveData();
}
function addCoins(userId, delta) {
  const uid = String(userId);
  data.coins[uid] = (parseInt(data.coins[uid] || 0) + parseInt(delta));
  saveData();
}
function canClaimHourly(userId, hours = 1) {
  const uid = String(userId);
  const last = data.hourly[uid];
  if (!last) return [true, null];
  const lastDt = new Date(last);
  const diffMs = Date.now() - lastDt.getTime();
  const remainMs = hours * 3600000 - diffMs;
  return [remainMs <= 0, remainMs > 0 ? remainMs : null];
}
function setHourly(userId) {
  data.hourly[String(userId)] = new Date().toISOString();
  saveData();
}

// ===== STOCKS SYSTEM =====
const STOCK_SYMBOLS = ['APPL', 'MSFT', 'BTC', 'ETH'];
function initStocks() {
  if (!data.stocks || Object.keys(data.stocks).length === 0) {
    STOCK_SYMBOLS.forEach(s => data.stocks[s] = Math.floor(Math.random() * 200) + 50);
    saveData();
  }
}
initStocks();

// update stock prices every 5 minutes
setInterval(() => {
  for (const s of STOCK_SYMBOLS) {
    const changePct = (Math.random() * 6 - 3); // -3% .. +3%
    const old = data.stocks[s] || 100;
    const next = Math.max(1, Math.round(old * (1 + changePct / 100)));
    data.stocks[s] = next;
  }
  saveData();
  console.log('Stock prices updated:', data.stocks);
}, 5 * 60 * 1000);

// ===== HORSE RACE CONFIG =====
const HORSES = [
  { name: '🐎 Ngựa Trắng', speed: 7, stamina: 8 },
  { name: '🏇 Ngựa Nâu', speed: 8, stamina: 6 },
  { name: '🐴 Ngựa Hoang', speed: 9, stamina: 5 },
  { name: '🦄 Ngựa Unicorn', speed: 6, stamina: 9 },
  { name: '🐎 Ngựa Chiến', speed: 7, stamina: 7 },
];

// ===== QUIZ QUESTIONS (simple example) =====
const QUIZ_QUESTIONS = [
  { q: 'Thủ đô của Pháp là gì?', a: 'paris' },
  { q: '2+2 bằng mấy?', a: '4' },
  { q: 'Thủ đô Nhật Bản?', a: 'tokyo' },
];

// ===== UTILITY: ensure guild user structures =====
function ensurePortfolio(userId) {
  if (!data.portfolio[String(userId)]) data.portfolio[String(userId)] = {};
}
function ensureWarns(userId) {
  if (!data.warns[String(userId)]) data.warns[String(userId)] = [];
}

// ===== EVENTS =====
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// chat XP placeholder? (we keep coins as economy; if you want XP level system, we can add later)

// ===== MESSAGE HANDLER =====
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    // === legacy !js command (echo code block) ===
    if (message.content.startsWith('!js')) {
      const code = message.content.slice(3).trim();
      if (!code) return message.reply('Vui lòng gửi kèm code JavaScript sau lệnh !js');
      return message.channel.send('```js\n' + code + '\n```');
    }

    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // ===== BASIC: ping/bal/lb =====
    if (cmd === 'ping') {
      return message.reply(`Pong! ${Math.round(client.ws.ping)}ms`);
    }

    if (cmd === 'bal') {
      const member = message.mentions.users.first() || message.author;
      return message.reply(`${member.username} có ${getCoins(member.id)} 💰 Skibidi Coin`);
    }

    if (cmd === 'lb') {
      const arr = Object.entries(data.coins).map(([uid, c]) => [uid, parseInt(c)]);
      arr.sort((a, b) => b[1] - a[1]);
      if (!arr.length) return message.reply('Chưa có dữ liệu Skibidi Coin.');
      const top = arr.slice(0, 10);
      const lines = await Promise.all(top.map(async ([uid, c], i) => {
        const m = await client.users.fetch(uid).catch(()=>null);
        return `#${i+1} ${m ? m.username : uid}: ${c} 💰`;
      }));
      return message.channel.send('🏆 Top Skibidi:\n' + lines.join('\n'));
    }

    // ===== HOURLY =====
    if (cmd === 'hr' || cmd === 'hourly' || cmd === 'claim') {
      const [ok, remainMs] = canClaimHourly(message.author.id, 1);
      if (!ok) {
        const mins = Math.floor(remainMs / 60000);
        const secs = Math.floor((remainMs % 60000) / 1000);
        return message.reply(`Bạn đã claim rồi. Hãy đợi ${mins} phút ${secs} giây nữa.`);
      }
      const reward = Math.floor(Math.random() * 41) + 10; // 10..50
      addCoins(message.author.id, reward);
      setHourly(message.author.id);
      return message.reply(`Bạn nhận ${reward} 💰 Skibidi Coin!`);
    }

    // ===== COINFLIP (bet by coin) =====
    if (cmd === 'coinflip') {
      if (args.length < 2) return message.reply('Cú pháp: ?coinflip <heads|tails> <amount>');
      const side = args[0].toLowerCase();
      const amount = parseInt(args[1]);
      if (!['heads','tails','h','t'].includes(side)) return message.reply('Chọn heads hoặc tails.');
      if (!amount || amount <= 0) return message.reply('Số tiền không hợp lệ.');
      if (getCoins(message.author.id) < amount) return message.reply('Bạn không đủ Skibidi Coin.');
      const pick = side.startsWith('h') ? 'heads' : 'tails';
      const res = Math.random() < 0.5 ? 'heads' : 'tails';
      if (pick === res) {
        addCoins(message.author.id, amount);
        return message.reply(`Kết quả: ${res}. Bạn thắng và được +${amount} 💰`);
      } else {
        addCoins(message.author.id, -amount);
        return message.reply(`Kết quả: ${res}. Bạn thua và mất ${amount} 💰`);
      }
    }

    // ===== STOCKS: ?stock prices / buy / sell / port =====
    if (cmd === 'stock' || cmd === 'stocks') {
      const sub = (args[0] || '').toLowerCase();
      if (!sub || sub === 'prices') {
        const lines = Object.entries(data.stocks).map(([s, p]) => `${s}: ${p} 💰`);
        return message.reply('📈 Giá cổ phiếu:\n' + lines.join('\n'));
      }
      if (sub === 'buy') {
        const sym = (args[1] || '').toUpperCase();
        const qty = parseInt(args[2] || '0');
        if (!STOCK_SYMBOLS.includes(sym)) return message.reply('Mã cổ phiếu không hợp lệ.');
        if (!qty || qty <= 0) return message.reply('Số lượng không hợp lệ.');
        const price = data.stocks[sym] || 100;
        const cost = price * qty;
        if (getCoins(message.author.id) < cost) return message.reply('Không đủ coin.');
        addCoins(message.author.id, -cost);
        ensurePortfolio(message.author.id);
        const port = data.portfolio[String(message.author.id)];
        port[sym] = (port[sym] || 0) + qty;
        saveData();
        return message.reply(`Mua ${qty} ${sym} giá ${cost} 💰`);
      }
      if (sub === 'sell') {
        const sym = (args[1] || '').toUpperCase();
        const qty = parseInt(args[2] || '0');
        ensurePortfolio(message.author.id);
        const port = data.portfolio[String(message.author.id)];
        if (!port[sym] || port[sym] < qty) return message.reply('Bạn không có đủ cổ phiếu.');
        const price = data.stocks[sym] || 100;
        const gain = price * qty;
        port[sym] -= qty;
        addCoins(message.author.id, gain);
        saveData();
        return message.reply(`Bán ${qty} ${sym} nhận ${gain} 💰`);
      }
      if (sub === 'port' || sub === 'portfolio') {
        ensurePortfolio(message.author.id);
        const port = data.portfolio[String(message.author.id)];
        if (!port || Object.keys(port).length === 0) return message.reply('Portfolio rỗng.');
        const lines = Object.entries(port).map(([s,q]) => `${s}: ${q}`);
        return message.reply('📦 Portfolio:\n' + lines.join('\n'));
      }
    }

    // ===== HORSE RACE: ?race, ?bet, ?startrace =====
    if (cmd === 'race') {
      const gid = String(message.guild.id);
      if (data.bets[gid]) return message.reply('Đã có race đang mở ở server này.');
      const horses = shuffleArray(HORSES).slice(0, 3); // take 3 random
      const desc = horses.map((h,i) => `${i+1}. ${h.name} (spd:${h.speed}, sta:${h.stamina})`).join('\n');
      const m = await message.channel.send(`🏇 **Race started!**\n${desc}\nĐặt cược với: ?bet <horse#> <coin>\nTự hủy sau 30s nếu không ai tham gia.`);
      data.bets[gid] = { horses, bets: {}, msgId: m.id };
      saveData();
      // auto-cancel after 30s if no bets
      setTimeout(async () => {
        const sess = data.bets[gid];
        if (!sess) return;
        if (Object.keys(sess.bets).length === 0) {
          // delete message if exists
          try {
            const msg = await message.channel.messages.fetch(sess.msgId);
            await msg.delete().catch(()=>null);
          } catch(_) {}
          delete data.bets[gid];
          saveData();
          message.channel.send('⏰ Hết giờ, không ai đặt cược. Cuộc đua đã bị hủy.');
        }
      }, 30 * 1000);
      return;
    }

    if (cmd === 'bet') {
      const gid = String(message.guild.id);
      const sess = data.bets[gid];
      if (!sess) return message.reply('Không có race đang diễn ra.');
      const horseIndex = parseInt(args[0]);
      const amount = parseInt(args[1]);
      if (!horseIndex || horseIndex < 1 || horseIndex > sess.horses.length) return message.reply('Ngựa không hợp lệ.');
      if (!amount || amount <= 0) return message.reply('Số tiền không hợp lệ.');
      if (getCoins(message.author.id) < amount) return message.reply('Không đủ Skibidi Coin.');
      addCoins(message.author.id, -amount); // immediately take coins
      sess.bets[String(message.author.id)] = { horse: horseIndex - 1, amount };
      saveData();
      return message.reply(`${message.author.username} đã cược ${amount} 💰 cho ngựa #${horseIndex}`);
    }

    if (cmd === 'startrace') {
      const gid = String(message.guild.id);
      const sess = data.bets[gid];
      if (!sess) return message.reply('Không có race để start.');
      if (!Object.keys(sess.bets).length) {
        delete data.bets[gid]; saveData(); return message.reply('Không ai cược, race bị huỷ.');
      }
      await message.channel.send('🚦 Cuộc đua bắt đầu...'); await sleep(3000);
      // winner based on speed + random up to stamina
      const scores = sess.horses.map(h => h.speed + randInt(0, h.stamina));
      const winnerIndex = scores.indexOf(Math.max(...scores));
      const winnerHorse = sess.horses[winnerIndex];
      let out = `🏁 Kết thúc! Ngựa thắng: ${winnerHorse.name}\n`;
      const winners = [];
      for (const [uid, b] of Object.entries(sess.bets)) {
        if (b.horse === winnerIndex) {
          const payout = b.amount * 2;
          addCoins(uid, payout);
          winners.push({ uid, payout });
        }
      }
      if (winners.length) {
        out += 'Người thắng:\n' + winners.map(w => `<@${w.uid}> +${w.payout} 💰`).join('\n');
      } else out += 'Không ai thắng cược.';
      delete data.bets[gid]; saveData();
      return message.channel.send(out);
    }

    // ===== QUIZ (kept simple) ====
    if (cmd === 'quiz') {
      const sub = (args[0] || '').toLowerCase();
      const gid = String(message.guild.id);
      if (!sub || sub === 'help') return message.reply('?quiz start | ?quiz answer <text> | ?quiz end');
      if (sub === 'start') {
        if (data.quiz[gid] && data.quiz[gid].active) return message.reply('Đã có quiz đang chạy.');
        const q = QUIZ_QUESTIONS[Math.floor(Math.random()*QUIZ_QUESTIONS.length)];
        data.quiz[gid] = { question: q.q, answer: q.a, active: true, points: {} };
        saveData();
        return message.channel.send(`🎲 Quiz: **${q.q}** — trả lời bằng ?quiz answer <câu trả lời>`);
      }
      if (sub === 'answer') {
        const txt = args.slice(1).join(' ');
        const sess = data.quiz[gid];
        if (!sess || !sess.active) return message.reply('Không có quiz đang hoạt động.');
        if (txt.trim().toLowerCase() === sess.answer.toLowerCase()) {
          sess.points[String(message.author.id)] = (sess.points[String(message.author.id)]||0)+1;
          addCoins(message.author.id, 20);
          saveData();
          return message.reply(`✅ Đúng! +20 💰`);
        } else return message.reply('Sai rồi!');
      }
      if (sub === 'end') {
        const sess = data.quiz[gid];
        if (!sess || !sess.active) return message.reply('Không có quiz.');
        sess.active = false; saveData();
        const pts = Object.entries(sess.points||{}).sort((a,b)=>b[1]-a[1]);
        if (!pts.length) return message.reply('Quiz kết thúc — không ai ghi điểm.');
        const out = pts.map(([uid, s],i)=>`#${i+1} <@${uid}> — ${s} points`).join('\n');
        return message.channel.send('📊 Quiz Results:\n' + out);
      }
    }

    // ===== ADMIN SUBCOMMANDS (single entry ?adcmd <sub> ...) =====
    if (cmd === 'adcmd') {
      // require admin
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply('Bạn không có quyền Admin.');
      }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'ban') {
        const mem = message.mentions.members.first();
        if (!mem) return message.reply('Tag người muốn ban.');
        await mem.ban().catch(e=>message.reply('Không thể ban: '+e.message));
        return message.reply(`🔨 Đã ban ${mem.user.tag}`);
      }
      if (sub === 'kick') {
        const mem = message.mentions.members.first();
        if (!mem) return message.reply('Tag người muốn kick.');
        await mem.kick().catch(e=>message.reply('Không thể kick: '+e.message));
        return message.reply(`👢 Đã kick ${mem.user.tag}`);
      }
      if (sub === 'mute') {
        const mem = message.mentions.members.first();
        if (!mem) return message.reply('Tag người muốn mute.');
        let muted = message.guild.roles.cache.find(r=>r.name==='Muted');
        if (!muted) {
          muted = await message.guild.roles.create({ name: 'Muted', permissions: [] });
          // set channel overwrite to prevent speaking/typing
          for (const [, ch] of message.guild.channels.cache) {
            try { await ch.permissionOverwrites.create(muted, { SendMessages: false, AddReactions: false, Speak: false }); } catch(_) {}
          }
        }
        await mem.roles.add(muted).catch(e=>message.reply('Không thể mute: '+e.message));
        return message.reply(`🔇 Đã mute ${mem.user.tag}`);
      }
      if (sub === 'unmute') {
        const mem = message.mentions.members.first();
        if (!mem) return message.reply('Tag người muốn unmute.');
        const muted = message.guild.roles.cache.find(r=>r.name==='Muted');
        if (muted) await mem.roles.remove(muted).catch(()=>null);
        return message.reply(`🔊 Đã unmute ${mem.user.tag}`);
      }
      if (sub === 'warn') {
        const mem = message.mentions.users.first();
        if (!mem) return message.reply('Tag user cần warn.');
        const reason = args.slice(1).join(' ') || 'No reason';
        ensureWarns(mem.id);
        data.warns[String(mem.id)].push({ by: message.author.tag, reason, time: new Date().toISOString() });
        saveData();
        return message.reply(`⚠️ Đã cảnh cáo ${mem.tag}: ${reason}`);
      }
      if (sub === 'warns') {
        const mem = message.mentions.users.first();
        if (!mem) return message.reply('Tag user để xem warns.');
        ensureWarns(mem.id);
        const list = data.warns[String(mem.id)];
        if (!list.length) return message.reply('Không có cảnh cáo.');
        const out = list.map((w,i)=>`${i+1}. bởi ${w.by} (${new Date(w.time).toLocaleString()}): ${w.reason}`).join('\n');
        return message.channel.send(`📋 Warns for ${mem.tag}:\n`+out);
      }
      if (sub === 'editbal') {
        const mem = message.mentions.users.first();
        const value = parseInt(args[2]);
        if (!mem || isNaN(value)) return message.reply('Cú pháp: ?adcmd editbal @user <amount>');
        setCoins(mem.id, value);
        return message.reply(`✅ Đã set ${mem.tag} = ${value} 💰`);
      }

      return message.reply('Admin cmds: ban/kick/mute/unmute/warn/warns/editbal');
    }

    // ===== OWNER COMMANDS: ?owncmd <sub> ... =====
    if (cmd === 'owncmd') {
      if (String(message.author.id) !== String(OWNER_ID)) return message.reply('Chỉ owner mới dùng được lệnh này.');
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'shutdown') {
        await message.reply('Shutting down...'); console.log('Owner requested shutdown.'); process.exit(0);
      }
      if (sub === 'giveadmin') {
        const mem = message.mentions.members.first();
        if (!mem) return message.reply('Tag member để cấp admin.');
        const role = await message.guild.roles.create({ name: 'TempAdmin', permissions: [PermissionsBitField.Flags.Administrator] }).catch(()=>null);
        if (role) await mem.roles.add(role).catch(()=>null);
        return message.reply(`✅ Đã cấp role admin cho ${mem.user.tag}`);
      }
      if (sub === 'say') {
        const txt = args.slice(1).join(' ');
        if (!txt) return message.reply('Cú pháp: ?owncmd say <text>');
        return message.channel.send(txt);
      }
      if (sub === 'eval') {
        const code = args.slice(1).join(' ');
        try {
          const result = eval(code);
          return message.reply('✅ Result: ' + String(result).slice(0,1900));
        } catch (e) {
          return message.reply('❌ Error: ' + e.message);
        }
      }
      return message.reply('Owner cmds: shutdown/giveadmin/say/eval');
    }

    // ===== CHATGPT: ?ask <prompt> =====
    if (cmd === 'ask') {
      if (!OPENAI_KEY || !openai) return message.reply('❌ OPENAI_API_KEY chưa cấu hình.');
      const prompt = args.join(' ');
      if (!prompt) return message.reply('Cú pháp: ?ask <câu hỏi>');
      await message.channel.send('⏳ Đang hỏi ChatGPT...');
      try {
        const resp = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800
        });
        const content = resp.choices?.[0]?.message?.content ?? 'Không có phản hồi.';
        // trim to discord limit
        return message.channel.send(content.slice(0, 1900));
      } catch (e) {
        console.error('OpenAI error', e);
        return message.reply('Lỗi khi gọi OpenAI: ' + (e.message || e));
      }
    }

    // other commands fallback
  } catch (err) {
    console.error('messageCreate handler error:', err);
    try { message.reply('Đã có lỗi: ' + err.message); } catch (_) {}
  }
});

// ===== UTIL FUNCTIONS =====
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function shuffleArray(a) { return a.slice().sort(()=>0.5 - Math.random()); }

// ===== LOGIN =====
if (!TOKEN) {
  console.error('ERROR: TOKEN env var missing. Set TOKEN in .env or environment variables.');
  process.exit(1);
}
client.login(TOKEN);
