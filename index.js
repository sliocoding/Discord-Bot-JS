// index.js — Full-featured Discord bot (Node.js, CommonJS)
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
const PORT = process.env.PORT || 10000;

// ===== OPENAI INIT (if provided) =====
let openaiClient = null;
if (OPENAI_KEY) openaiClient = new OpenAI({ apiKey: OPENAI_KEY });

// ===== KEEP-ALIVE WEB SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.get('/health', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

// ===== DATA =====
const defaultData = {
  coins: {}, hourly: {}, quiz: {}, bets: {}, stocks: {}, portfolio: {}, warns: {}
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2)); return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
}
let data = loadData();
function saveData() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) { console.error('saveData error', e); } }

// ===== HELPERS =====
const getCoins = id => parseInt(data.coins[String(id)] || 0);
const setCoins = (id, v) => { data.coins[String(id)] = parseInt(v); saveData(); };
const addCoins = (id, delta) => { const uid=String(id); data.coins[uid] = (parseInt(data.coins[uid]||0) + parseInt(delta)); saveData(); };

function canClaimHourly(id, hours=1){
  const uid=String(id);
  const last = data.hourly[uid];
  if(!last) return [true, null];
  const remain = hours*3600000 - (Date.now() - new Date(last).getTime());
  return [remain <= 0, remain>0?remain:null];
}
function setHourly(id){ data.hourly[String(id)] = new Date().toISOString(); saveData(); }

function ensurePortfolio(uid){ if(!data.portfolio[String(uid)]) data.portfolio[String(uid)] = {}; }
function ensureWarns(uid){ if(!data.warns[String(uid)]) data.warns[String(uid)] = []; }

// ===== STOCKS (init + update every 5min) =====
const STOCKS = ['APPL','MSFT','BTC','ETH'];
if(!data.stocks || Object.keys(data.stocks).length===0) {
  STOCKS.forEach(s => data.stocks[s] = Math.floor(Math.random()*200)+50);
  saveData();
}
setInterval(()=>{
  for(const s of STOCKS){
    const old = data.stocks[s] || 100;
    const pct = (Math.random()*6 - 3); // -3..+3%
    const next = Math.max(1, Math.round(old*(1 + pct/100)));
    data.stocks[s] = next;
  }
  saveData();
  console.log('Stock updated', data.stocks);
}, 5*60*1000);

// ===== HORSES (for race) =====
const HORSE_POOL = [
  {name:'🐎 Ngựa Trắng', speed:7, stamina:8},
  {name:'🏇 Ngựa Nâu', speed:8, stamina:6},
  {name:'🦄 Ngựa Cầu Vồng', speed:6, stamina:9},
  {name:'🐴 Ngựa Hoang', speed:9, stamina:5},
  {name:'🐎 Ngựa Chiến', speed:7, stamina:7},
];

// ===== QUIZ QUESTIONS =====
const QUIZ_QS = [
  {q:'Thủ đô của Pháp là gì?', a:'paris'},
  {q:'2+2 bằng mấy?', a:'M bị ngu hay j mà không biết'},
  {q:'Thủ đô Nhật Bản?', a:'tokyo'}
];

// ===== UTILS =====
const randInt = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
const sleep = ms=> new Promise(r=>setTimeout(r,ms));
const shuffle = arr => arr.slice().sort(()=>0.5-Math.random());

// ===== DISCORD CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// single message handler (prefix = ?)
client.on('messageCreate', async message => {
  try {
    if(message.author.bot) return;
    // fallback old-style !js (echo code block)
    if(message.content.startsWith('!js')) {
      const code = message.content.slice(3).trim();
      if(!code) return message.reply('Gửi kèm code sau !js');
      return message.channel.send('```js\n'+code+'\n```');
    }

    if(!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // ===== BASIC =====
    if(cmd === 'ping') return message.reply(`Pong! ${Math.round(client.ws.ping)}ms`);
    if(cmd === 'bal') {
      const user = message.mentions.users.first() || message.author;
      return message.reply(`${user.username} có ${getCoins(user.id)} 💰 Skibidi Coin`);
    }
    if(cmd === 'lb' || cmd === 'leaderboard') {
      const arr = Object.entries(data.coins).map(([u,c])=>[u,parseInt(c)]).sort((a,b)=>b[1]-a[1]).slice(0,10);
      if(!arr.length) return message.reply('Chưa có dữ liệu.');
      const lines = await Promise.all(arr.map(async ([uid,c],i)=>{ const u = await client.users.fetch(uid).catch(()=>null); return `#${i+1} ${u?u.username:uid}: ${c} 💰`; }));
      return message.channel.send('🏆 Top:\n'+lines.join('\n'));
    }

    // ===== HOURLY =====
    if(cmd === 'hr' || cmd === 'hourly' || cmd === 'claim') {
      const [ok, remain] = canClaimHourly(message.author.id, 1);
      if(!ok) {
        const mins = Math.floor(remain/60000); const secs = Math.floor((remain%60000)/1000);
        return message.reply(`Bạn đã claim rồi. Hãy đợi ${mins} phút ${secs} giây.`);
      }
      const reward = randInt(10,50);
      addCoins(message.author.id, reward);
      setHourly(message.author.id);
      return message.reply(`${message.author.username} nhận ${reward} 💰 Skibidi Coin`);
    }

    // ===== COINFLIP =====
    if(cmd === 'coinflip' || cmd === 'cf') {
      // ?cf <heads|tails> <amount>
      if(args.length < 2) return message.reply('Cú pháp: ?cf <heads|tails> <amount>');
      const side = args[0].toLowerCase();
      const amount = parseInt(args[1]);
      if(!['heads','tails','h','t'].includes(side)) return message.reply('Chọn heads hoặc tails.');
      if(!amount || amount <= 0) return message.reply('Số tiền không hợp lệ.');
      if(getCoins(message.author.id) < amount) return message.reply('Không đủ Skibidi Coin.');
      const pick = side.startsWith('h') ? 'heads' : 'tails';
      const res = Math.random() < 0.5 ? 'heads' : 'tails';
      if(pick === res) { addCoins(message.author.id, amount); return message.reply(`Kết quả ${res}. Bạn thắng +${amount} 💰`); }
      else { addCoins(message.author.id, -amount); return message.reply(`Kết quả ${res}. Bạn thua -${amount} 💰`); }
    }

    // ===== STOCKS =====
    if(cmd === 'stock' || cmd === 'stocks') {
      const sub = (args[0]||'').toLowerCase();
      if(!sub || sub==='prices' || sub==='price') {
        const lines = Object.entries(data.stocks).map(([s,p])=>`${s}: ${p} 💰`);
        return message.reply('📈 Giá cổ phiếu:\n'+lines.join('\n'));
      }
      if(sub === 'buy') {
        const sym = (args[1]||'').toUpperCase(); const qty = parseInt(args[2]||'0');
        if(!STOCKS.includes(sym)) return message.reply('Mã cổ phiếu không hợp lệ.');
        if(!qty || qty<=0) return message.reply('Số lượng không hợp lệ.');
        const cost = data.stocks[sym]*qty;
        if(getCoins(message.author.id) < cost) return message.reply('Không đủ coin.');
        addCoins(message.author.id, -cost);
        ensurePortfolio(message.author.id);
        data.portfolio[String(message.author.id)][sym] = (data.portfolio[String(message.author.id)][sym]||0) + qty;
        saveData();
        return message.reply(`Mua ${qty} ${sym} giá ${cost} 💰`);
      }
      if(sub === 'sell') {
        const sym = (args[1]||'').toUpperCase(); const qty = parseInt(args[2]||'0');
        ensurePortfolio(message.author.id);
        const port = data.portfolio[String(message.author.id)];
        if(!port[sym] || port[sym] < qty) return message.reply('Không đủ cổ phiếu.');
        const gain = data.stocks[sym]*qty;
        port[sym] -= qty; addCoins(message.author.id, gain); saveData();
        return message.reply(`Bán ${qty} ${sym} nhận ${gain} 💰`);
      }
      if(sub === 'port' || sub === 'portfolio') {
        ensurePortfolio(message.author.id);
        const port = data.portfolio[String(message.author.id)];
        if(!port || Object.keys(port).length===0) return message.reply('Portfolio rỗng.');
        const lines = Object.entries(port).map(([s,q])=>`${s}: ${q}`);
        return message.reply('📦 Portfolio:\n'+lines.join('\n'));
      }
      return message.reply('Lệnh stock: ?stock price | ?stock buy <symbol> <qty> | ?stock sell <symbol> <qty> | ?stock port');
    }

    // ===== HORSE RACE (lobby 30s, bets) =====
    if(cmd === 'race') {
      const gid = String(message.guild.id);
      if(data.bets[gid]) return message.reply('Đã có race đang mở.');
      const horses = shuffle(HORSE_POOL).slice(0,3);
      const desc = horses.map((h,i)=>`${i+1}. ${h.name} (spd:${h.speed}, sta:${h.stamina})`).join('\n');
      const m = await message.channel.send(`🏇 **Race lobby**\n${desc}\nĐặt cược: ?bet <horse#> <amount>\nTự hủy sau 30s nếu không ai tham gia.`);
      data.bets[gid] = { horses, bets: {}, msgId: m.id, channelId: message.channel.id };
      saveData();
      setTimeout(async ()=>{
        const sess = data.bets[gid];
        if(!sess) return;
        if(Object.keys(sess.bets).length === 0) {
          try { const msg = await message.channel.messages.fetch(sess.msgId); await msg.delete().catch(()=>null); } catch(_) {}
          delete data.bets[gid]; saveData();
          message.channel.send('⏰ Hết giờ, không ai đặt cược. Cuộc đua bị hủy.');
        }
      }, 30000);
      return;
    }

    if(cmd === 'bet') {
      const gid = String(message.guild.id);
      const sess = data.bets[gid];
      if(!sess) return message.reply('Không có race.');
      const horseIdx = parseInt(args[0]); const amount = parseInt(args[1]);
      if(!horseIdx || horseIdx<1 || horseIdx>sess.horses.length) return message.reply('Ngựa không hợp lệ.');
      if(!amount || amount<=0) return message.reply('Số tiền không hợp lệ.');
      if(getCoins(message.author.id) < amount) return message.reply('Không đủ coin.');
      addCoins(message.author.id, -amount);
      sess.bets[String(message.author.id)] = { horse: horseIdx-1, amount };
      saveData();
      return message.reply(`${message.author.username} cược ${amount} vào ngựa #${horseIdx}`);
    }

    if(cmd === 'startrace') {
      const gid = String(message.guild.id);
      const sess = data.bets[gid];
      if(!sess) return message.reply('Không có race.');
      if(Object.keys(sess.bets).length === 0) { delete data.bets[gid]; saveData(); return message.reply('Không ai cược.'); }
      await message.channel.send('🚦 Race starts in 3s...'); await sleep(3000);
      const scores = sess.horses.map(h => h.speed + randInt(0, h.stamina));
      const winnerIdx = scores.indexOf(Math.max(...scores));
      const winnerHorse = sess.horses[winnerIdx];
      let out = `🏁 Kết thúc! Ngựa thắng: ${winnerHorse.name}\n`;
      const winners = [];
      for(const [uid, b] of Object.entries(sess.bets)){
        if(b.horse === winnerIdx) { const payout = b.amount * 2; addCoins(uid, payout); winners.push({uid, payout}); }
      }
      out += winners.length ? 'Người thắng:\n' + winners.map(w=>`<@${w.uid}> +${w.payout} 💰`).join('\n') : 'Không ai thắng cược.';
      delete data.bets[gid]; saveData();
      return message.channel.send(out);
    }

    // ===== QUIZ =====
    if(cmd === 'quiz') {
      const sub = (args[0]||'').toLowerCase(); const gid = String(message.guild.id);
      if(!sub || sub==='help') return message.reply('?quiz start | ?quiz answer <text> | ?quiz end');
      if(sub === 'start') {
        if(data.quiz[gid] && data.quiz[gid].active) return message.reply('Quiz đang chạy.');
        const q = QUIZ_QS[randInt(0, QUIZ_QS.length-1)];
        data.quiz[gid] = { question: q.q, answer: q.a, active: true, points: {} };
        saveData();
        return message.channel.send(`🎲 Quiz: **${q.q}** — trả lời bằng ?quiz answer <câu trả lời>`);
      }
      if(sub === 'answer') {
        const text = args.slice(1).join(' ');
        const sess = data.quiz[gid];
        if(!sess || !sess.active) return message.reply('Không có quiz.');
        if(text.trim().toLowerCase() === sess.answer.toLowerCase()) {
          sess.points[String(message.author.id)] = (sess.points[String(message.author.id)]||0) + 1;
          addCoins(message.author.id, 20); saveData();
          return message.reply(`✅ ${message.author.username} đúng! +20 💰`);
        } else return message.reply('Sai rồi!');
      }
      if(sub === 'end') {
        const sess = data.quiz[gid];
        if(!sess || !sess.active) return message.reply('Không có quiz.');
        sess.active = false; saveData();
        const out = Object.entries(sess.points||{}).sort((a,b)=>b[1]-a[1]).map((p,i)=>`#${i+1} <@${p[0]}> — ${p[1]} pts`).join('\n');
        return message.channel.send('📊 Kết quả:\n'+(out||'Không ai ghi điểm.'));
      }
    }

    // ===== MINI GAMES (guess, ppt, demso) =====
    // guess (starts collector)
    if(cmd === 'guess') {
      if(globalThis._guessGame && globalThis._guessGame.channelId === message.channel.id)
        return message.reply('Game đoán số đang diễn ra ở kênh này.');
      const ans = randInt(1,100);
      globalThis._guessGame = { channelId: message.channel.id, answer: ans };
      message.channel.send('Đoán số 1-100! Bạn có 60s. Gõ số để đoán.');
      const filter = m => !m.author.bot && m.channel.id === message.channel.id;
      const collector = message.channel.createMessageCollector({ filter, time: 60000 });
      collector.on('collect', m => {
        const g = parseInt(m.content);
        if(isNaN(g)) return;
        if(g === globalThis._guessGame.answer) {
          m.reply(`🎉 Đúng! Số là ${globalThis._guessGame.answer}`);
          globalThis._guessGame = null; collector.stop();
        } else if(g < globalThis._guessGame.answer) m.reply('Lớn hơn!');
        else m.reply('Nhỏ hơn!');
      });
      collector.on('end', () => { if(globalThis._guessGame){ message.channel.send(`Hết giờ! Số đúng: ${globalThis._guessGame.answer}`); globalThis._guessGame=null; }});
      return;
    }

    // ppt
    if(cmd === 'ppt') {
      const choice = (args[0]||'').toLowerCase();
      if(!['kéo','búa','bao'].includes(choice)) return message.reply('Cú pháp: ?ppt kéo/búa/bao');
      const botChoice = ['kéo','búa','bao'][randInt(0,2)];
      if(botChoice === choice) return message.reply(`Tôi chọn ${botChoice}. Hòa!`);
      if((choice==='kéo'&&botChoice==='bao')||(choice==='búa'&&botChoice==='kéo')||(choice==='bao'&&botChoice==='búa'))
        return message.reply(`Tôi chọn ${botChoice}. Bạn thắng!`);
      return message.reply(`Tôi chọn ${botChoice}. Bạn thua!`);
    }

    // demso
    if(cmd === 'demso') {
      let count = 0;
      message.channel.send('Game đếm số bắt đầu! Gõ số 1 để bắt đầu.');
      const filter = m => !m.author.bot && m.channel.id === message.channel.id && m.content === String(count+1);
      const collector = message.channel.createMessageCollector({ filter, time: 60000 });
      collector.on('collect', m => {
        count++;
        m.react('✅');
        if(count >= 10){ m.reply('Đã đủ 10!'); collector.stop(); }
      });
      collector.on('end', () => message.channel.send('Game đếm số kết thúc.'));
      return;
    }

    // ===== ADMIN COMMANDS (single entrypoint) =====
    if(cmd === 'adcmd') {
      if(!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('Bạn không có quyền Admin.');
      const sub = (args[0]||'').toLowerCase();
      // ban
      if(sub === 'ban') {
        const m = message.mentions.members.first(); if(!m) return message.reply('Tag member');
        await m.ban().catch(e=>message.reply('Không thể ban: '+e.message)); return message.reply(`Đã ban ${m.user.tag}`);
      }
      // kick
      if(sub === 'kick') {
        const m = message.mentions.members.first(); if(!m) return message.reply('Tag member');
        await m.kick().catch(e=>message.reply('Không thể kick: '+e.message)); return message.reply(`Đã kick ${m.user.tag}`);
      }
      // mute
      if(sub === 'mute') {
        const m = message.mentions.members.first(); if(!m) return message.reply('Tag member');
        let muted = message.guild.roles.cache.find(r=>r.name==='Muted');
        if(!muted) muted = await message.guild.roles.create({ name:'Muted', permissions:[] });
        for(const [, ch] of message.guild.channels.cache) {
          try { await ch.permissionOverwrites.edit(muted, { SendMessages: false, AddReactions: false, Speak: false }); } catch(_) {}
        }
        await m.roles.add(muted).catch(()=>null); return message.reply(`Muted ${m.user.tag}`);
      }
      // unmute
      if(sub === 'unmute') {
        const m = message.mentions.members.first(); if(!m) return message.reply('Tag member');
        const muted = message.guild.roles.cache.find(r=>r.name==='Muted');
        if(muted) await m.roles.remove(muted).catch(()=>null); return message.reply(`Unmuted ${m.user.tag}`);
      }
      // warn
      if(sub === 'warn') {
        const user = message.mentions.users.first(); if(!user) return message.reply('Tag user'); const reason = args.slice(1).join(' ') || 'No reason';
        ensureWarns(user.id); data.warns[String(user.id)].push({ by: message.author.tag, reason, time: new Date().toISOString() }); saveData();
        return message.reply(`⚠️ Warned ${user.tag}`);
      }
      // warns
      if(sub === 'warns') {
        const user = message.mentions.users.first(); if(!user) return message.reply('Tag user'); ensureWarns(user.id);
        const list = data.warns[String(user.id)]; if(!list.length) return message.reply('No warns');
        return message.channel.send('Warns:\n' + list.map((w,i)=>`${i+1}. by ${w.by} (${new Date(w.time).toLocaleString()}): ${w.reason}`).join('\n'));
      }
      // editbal
      if(sub === 'editbal') {
        const user = message.mentions.users.first(); const amount = parseInt(args[2]);
        if(!user || isNaN(amount)) return message.reply('Usage: ?adcmd editbal @user <amount>');
        setCoins(user.id, amount); return message.reply(`Set ${user.tag} = ${amount} 💰`);
      }
      // clear
      if(sub === 'clear') {
        const amt = parseInt(args[1]||'10'); const msgs = await message.channel.bulkDelete(Math.min(100, amt+1)).catch(()=>[]);
        return message.reply(`Đã xóa ${msgs.length-1} tin nhắn`).then(m=>setTimeout(()=>m.delete().catch(()=>{}),3000));
      }
      return message.reply('Admin cmds: ban/kick/mute/unmute/warn/warns/editbal/clear');
    }

    // ===== OWNER COMMANDS =====
    if(cmd === 'owncmd') {
      if(String(message.author.id) !== String(OWNER_ID)) return message.reply('Chỉ owner!');
      const sub = (args[0]||'').toLowerCase();
      if(sub === 'shutdown') { await message.reply('Shutting down...'); process.exit(0); }
      if(sub === 'giveadmin') { const m = message.mentions.members.first(); if(!m) return message.reply('Tag member'); const role = await message.guild.roles.create({ name:'TempAdmin', permissions:[PermissionsBitField.Flags.Administrator] }).catch(()=>null); if(role) await m.roles.add(role).catch(()=>null); return message.reply(`Gave admin to ${m.user.tag}`); }
      if(sub === 'say') { const txt = args.slice(1).join(' '); if(!txt) return message.reply('Usage: ?owncmd say <text>'); return message.channel.send(txt); }
      if(sub === 'eval') { const code = args.slice(1).join(' '); try{ const res = eval(code); return message.reply('Result: '+String(res).slice(0,1900)); } catch(e){ return message.reply('Eval error: '+e.message); } }
      return message.reply('Owner cmds: shutdown/giveadmin/say/eval');
    }

    // ===== CHATGPT: ?ask <prompt> =====
    if(cmd === 'ask') {
      if(!openaiClient) return message.reply('OpenAI key missing - ask owner to set OPENAI_API_KEY.');
      const prompt = args.join(' ');
      if(!prompt) return message.reply('Usage: ?ask <prompt>');
      await message.reply('⏳ Đang gọi OpenAI...');
      try {
        // use chat completions
        const resp = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role:'user', content: prompt }],
          max_tokens: 800
        });
        const content = resp.choices?.[0]?.message?.content || resp.choices?.[0]?.message || 'No response';
        return message.channel.send(String(content).slice(0,1900));
      } catch (e) {
        console.error('OpenAI error', e);
        const msg = (e && e.message) ? e.message : String(e);
        if(msg.includes('quota') || msg.includes('429')) return message.reply('OpenAI error: quota exceeded or billing needed.');
        return message.reply('OpenAI error: ' + msg);
      }
    }

    // fallback: unknown command
  } catch(err) {
    console.error('Handler error', err);
    try { message.reply('Có lỗi xảy ra: ' + (err.message||String(err)).slice(0,1900)); } catch(_) {}
  }
});

// login
if(!TOKEN) { console.error('Missing TOKEN env var'); process.exit(1); }
client.login(TOKEN);
