// ============================================================
// 命运卡牌 — Three.js 3D 卡牌构筑 Roguelike
// 玩法: 抽牌 → 打牌(攻击/防御/技能) → 敌人行动 → 清怪选牌构筑卡组
// 3D 战场: 几何体地牢 + 玩家/敌人（几何体，秒开）
// 卡牌: Canvas 绘制（费用/名称/效果），点击出牌
// 测试接口: window.__game_state + ?test=1&speed=4 | 三端触控
// ============================================================
import * as THREE from 'three';
import { BgmPlayer } from './bgm.js';
import { donateButtons } from './ui-kit.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SPEED = TEST ? (parseFloat(params.get('speed')) || 4) : 1;

// ---- 卡牌库 ----
const CARD_LIBRARY = [
  { id: 'strike', name: '打击', cost: 1, dmg: 6, type: 'atk', color: '#e8794f', desc: '造成 6 点伤害' },
  { id: 'bash', name: '重击', cost: 2, dmg: 12, type: 'atk', color: '#d95e38', desc: '造成 12 点伤害' },
  { id: 'guard', name: '防御', cost: 1, block: 6, type: 'def', color: '#6eb5ff', desc: '获得 6 点护甲' },
  { id: 'iron', name: '铁壁', cost: 2, block: 12, type: 'def', color: '#4a8ac9', desc: '获得 12 点护甲' },
  { id: 'fire', name: '火球', cost: 2, dmg: 10, burn: 3, type: 'atk', color: '#ff6b4a', desc: '10 伤害 + 灼烧 3' },
  { id: 'heal', name: '治愈', cost: 1, heal: 8, type: 'skill', color: '#6bc46b', desc: '恢复 8 点生命' },
  { id: 'double', name: '双重打击', cost: 1, dmg: 4, hits: 2, type: 'atk', color: '#ff9f43', desc: '造成 4×2 伤害' },
  { id: 'power', name: '蓄力', cost: 1, power: 2, type: 'skill', color: '#9a6bff', desc: '力量 +2' },
];

// 初始卡组
const START_DECK = ['strike', 'strike', 'strike', 'guard', 'guard', 'bash'];

// 敌人
const ENEMIES = [
  { name: '骷髅兵', hp: 25, dmg: 5, color: 0xcccccc, scale: 0.7 },
  { name: '哥布林', hp: 20, dmg: 7, color: 0x6bc46b, scale: 0.7 },
  { name: '暗影刺客', hp: 35, dmg: 9, color: 0x8a5adf, scale: 0.8 },
  { name: '地牢领主', hp: 60, dmg: 12, color: 0xe05a5a, scale: 1.1 },
];

export default function initCardGame() {
  // ---- 渲染器 ----
  const canvas = document.querySelector('canvas') || document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5a4a6a);
  scene.fog = new THREE.Fog(0x5a4a6a, 22, 45);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 8, 9);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x7a6a9a, 2.5));
  const sun = new THREE.DirectionalLight(0xffd0a0, 2.0);
  sun.position.set(6, 10, 4);
  sun.castShadow = true;
  scene.add(sun);

  // ---- 游戏状态 ----
  const game = {
    hp: 80, maxHp: 80, block: 0, energy: 3, maxEnergy: 3,
    power: 0, room: 1, kills: 0, gold: 0,
    deck: [...START_DECK], hand: [], drawPile: [], discardPile: [],
    enemy: null, phase: 'player', lastTime: 0, over: false,
  };

  // 测试接口
  window.__game_state = {
    get hp() { return Math.max(0, game.hp); },
    get score() { return game.kills; },
    get wave() { return game.room; },
    get weapons() { return [...new Set([...game.deck, ...game.hand])].map(id => CARD_LIBRARY.find(c => c.id === id)?.name || id); },
    get enemies() { return game.enemy ? 1 : 0; },
    get screen() { return game.over ? 'gameover' : game.phase; },
  };

  // ---- 3D 场景（几何体，秒开）----
  function buildArena() {
    // 地板
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a7a9a, roughness: 0.85 }));
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);
    // 墙
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a3a6a, roughness: 0.8 });
    const wallGeo = new THREE.BoxGeometry(1.6, 1.6, 0.3);
    for (let i = -3; i <= 3; i += 2) {
      for (const z of [-4, 4]) {
        const w = new THREE.Mesh(wallGeo, wallMat);
        w.position.set(i, 0.8, z);
        w.userData.arena = true; scene.add(w);
      }
      for (const x of [-4, 4]) {
        const w = new THREE.Mesh(wallGeo, wallMat);
        w.position.set(x, 0.8, i);
        w.rotation.y = Math.PI / 2;
        w.userData.arena = true; scene.add(w);
      }
    }
    // 水晶柱
    const crystalColors = [0x6eb5ff, 0xff6b9d, 0x9a6bff, 0xffd166];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: crystalColors[i], emissive: crystalColors[i], emissiveIntensity: 0.5 }));
      c.position.set(-3 + i * 2, 0.6, -3);
      c.userData.arena = true;
      scene.add(c);
    }
  }

  function buildHuman(color = 0xe8794f) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3a6a, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), mat); head.position.y = 1.4; g.add(head);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.65, 8), dark); body.position.y = 0.95; g.add(body);
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6), dark); legL.position.set(-0.12, 0.3, 0); g.add(legL);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6), dark); legR.position.set(0.12, 0.3, 0); g.add(legR);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  function buildEnemyMesh(t) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5 * t.scale, 12, 12),
      new THREE.MeshStandardMaterial({ color: t.color, emissive: t.color, emissiveIntensity: 0.3, roughness: 0.6 }));
    body.position.y = 0.55;
    g.add(body);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
      eye.position.set(side * 0.17, 0.7, 0.4);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pupilMat);
      pupil.position.set(side * 0.17, 0.7, 0.5);
      g.add(eye); g.add(pupil);
    }
    g.position.set(0, 0, -2);
    g.castShadow = true;
    scene.add(g);
    return g;
  }

  const playerMesh = buildHuman();
  playerMesh.position.set(0, 0, 2);
  scene.add(playerMesh);

  // ---- 卡牌系统 ----
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  function drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (game.drawPile.length === 0) {
        game.drawPile = [...game.discardPile];
        game.discardPile = [];
        shuffle(game.drawPile);
      }
      if (game.drawPile.length === 0) break;
      const card = game.drawPile.pop();
      game.hand.push(card);
    }
  }
  function newTurn() {
    game.energy = game.maxEnergy;
    game.block = 0;
    game.discardPile.push(...game.hand);
    game.hand = [];
    drawCards(5);
    game.phase = 'player';
    renderHand();
    updateHUD();
  }
  function startFight() {
    const types = ENEMIES.slice(0, Math.min(ENEMIES.length, 1 + Math.floor(game.room / 3)));
    const t = types[Math.floor(Math.random() * types.length)];
    game.enemy = { ...t, hp: t.hp + game.room * 3, mesh: null };
    game.enemy.mesh = buildEnemyMesh(t);
    flash(`⚔️ ${game.enemy.name} 出现了！`);
    newTurn();
  }
  function playCard(cardId) {
    if (game.phase !== 'player' || game.over) return;
    const card = CARD_LIBRARY.find(c => c.id === cardId);
    if (!card || game.energy < card.cost) return;
    if (!game.hand.includes(cardId)) return;
    game.energy -= card.cost;
    game.hand = game.hand.filter(c => c !== cardId);
    game.discardPile.push(cardId);
    // 效果
    const dmg = (card.dmg || 0) + game.power;
    if (card.dmg) {
      const total = card.hits ? dmg * card.hits : dmg;
      game.enemy.hp -= total;
      sfx(500, 0.12);
      hitFloat(-total);
      if (game.enemy.hp <= 0) { killEnemy(); return; }
    }
    if (card.block) { game.block += card.block; sfx(300, 0.15); }
    if (card.heal) { game.hp = Math.min(game.maxHp, game.hp + card.heal); sfx(700, 0.15); }
    if (card.power) { game.power += card.power; flash('力量 +' + card.power); }
    if (card.burn) { game.enemy.hp -= card.burn; hitFloat(-card.burn); if (game.enemy.hp <= 0) { killEnemy(); return; } }
    renderHand();
    updateHUD();
    // 没能量/没牌 → 敌人回合
    if (game.energy <= 0 || game.hand.length === 0) setTimeout(enemyTurn, 600 / SPEED);
  }
  function killEnemy() {
    const killed = game.enemy;
    scene.remove(killed.mesh);
    game.kills++;
    game.gold += 10 + game.room * 2;
    game.enemy = null;
    flash(`💀 ${killed.name} 被击败！`);
    setTimeout(() => showReward(), 800 / SPEED);
  }
  function enemyTurn() {
    if (game.over || !game.enemy) return;
    game.phase = 'enemy';
    // 敌人攻击
    let dmg = game.enemy.dmg;
    if (game.block > 0) {
      const absorbed = Math.min(game.block, dmg);
      game.block -= absorbed;
      dmg -= absorbed;
    }
    game.hp -= dmg;
    sfx(200, 0.15);
    hitFloat(dmg, true);
    if (game.hp <= 0) { gameOver(); return; }
    flash(`${game.enemy.name} 攻击！-${dmg}`);
    setTimeout(newTurn, 700 / SPEED);
  }
  // 战后奖励（三选一卡牌）
  function showReward() {
    if (game.over) return;
    game.room++;
    const pool = CARD_LIBRARY.filter(c => !game.deck.includes(c.id)).length > 0
      ? [...CARD_LIBRARY].sort(() => Math.random() - 0.5).slice(0, 3)
      : [...CARD_LIBRARY].sort(() => Math.random() - 0.5).slice(0, 3);
    const panel = document.createElement('div');
    panel.id = 'reward-panel';
    panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:99';
    panel.innerHTML = '<div style="color:#fff;font:bold 22px Arial">🎴 选择一张卡加入卡组</div>';
    pool.forEach(c => {
      const b = document.createElement('button');
      b.textContent = `${c.name}（${c.cost}费）— ${c.desc}`;
      b.style.cssText = `background:${c.color};color:#fff;font:bold 14px Arial;padding:12px 24px;border:none;border-radius:12px;cursor:pointer`;
      b.onclick = () => {
        game.deck.push(c.id);
        panel.remove();
        startFight();
      };
      panel.appendChild(b);
    });
    document.body.appendChild(panel);
    if (TEST) setTimeout(() => { const b = panel.querySelector('button'); if (b) b.click(); }, 600 / SPEED);
  }
  function gameOver() {
    game.over = true;
    flash(`☠️ 倒在 ${game.room} 层 · 击杀 ${game.kills}`);
    setTimeout(() => { if (confirm('再来一局？')) location.reload(); }, 1500 / SPEED);
  }

  // ---- 卡牌 UI（DOM）----
  const handEl = document.createElement('div');
  handEl.style.cssText = 'position:fixed;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;z-index:90;padding:0 10px';
  document.body.appendChild(handEl);

  function renderHand() {
    handEl.innerHTML = '';
    game.hand.forEach(cardId => {
      const c = CARD_LIBRARY.find(x => x.id === cardId);
      const el = document.createElement('div');
      const disabled = game.energy < c.cost || game.phase !== 'player';
      el.style.cssText = `width:90px;height:130px;background:${disabled ? '#888' : c.color};border:2px solid #fff;border-radius:10px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${disabled ? 'not-allowed' : 'pointer'};font:bold 12px Arial;box-shadow:0 3px 8px rgba(0,0,0,.4)`;
      el.innerHTML = `<div style="font-size:16px">${c.cost}⚡</div><div style="margin:4px 0">${c.name}</div><div style="font-size:9px;text-align:center;padding:0 4px">${c.desc}</div>`;
      if (!disabled) el.onclick = () => playCard(cardId);
      handEl.appendChild(el);
    });
  }

  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:10px;left:10px;font:bold 14px Arial;color:#fff;background:rgba(0,0,0,0.6);padding:8px 12px;border-radius:10px;z-index:95';
  document.body.appendChild(hud);
  function updateHUD() {
    hud.innerHTML = `❤ ${Math.max(0, game.hp)}/${game.maxHp} ${game.block > 0 ? `🛡${game.block}` : ''} &nbsp;⚡ ${game.energy}/${game.maxEnergy} &nbsp;⚔️ 力量${game.power} &nbsp;🏰 第${game.room}层 &nbsp;💀 ${game.kills}` +
      (game.enemy ? `<br>👾 ${game.enemy.name} ❤${Math.max(0, game.enemy.hp)}` : '');
  }
  function flash(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);font:bold 20px Arial;color:#ffe28a;background:rgba(0,0,0,0.75);padding:8px 16px;border-radius:12px;z-index:99;transition:opacity .8s;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 800); }, 1300 / SPEED);
  }
  function hitFloat(amount, onPlayer = false) {
    const el = document.createElement('div');
    el.textContent = (amount > 0 ? '+' : '') + amount;
    el.style.cssText = `position:fixed;top:40%;left:${onPlayer ? '30' : '60'}%;font:bold 20px Arial;color:${onPlayer ? '#ff6b6b' : '#ffe28a'};z-index:95;transition:all .7s;pointer-events:none`;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transform = 'translateY(-25px)'; el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 100);
  }
  let bgm;
  function sfx(freq, dur) {
    try {
      if (!bgm) return;
      const o = bgm.ctx.createOscillator(), g = bgm.ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.08, bgm.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, bgm.ctx.currentTime + dur);
      o.connect(g).connect(bgm.ctx.destination);
      o.start(); o.stop(bgm.ctx.currentTime + dur);
    } catch (e) {}
  }
  renderer.domElement.addEventListener('pointerdown', () => { if (!bgm) { bgm = new BgmPlayer(); bgm.ensure(); bgm.play(); } });

  // ---- 主循环 ----
  function animate(time) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, (time - game.lastTime) / 1000);
    game.lastTime = time;
    // 敌人浮动动画
    if (game.enemy && game.enemy.mesh) {
      game.enemy.mesh.position.y = Math.sin(time * 0.002) * 0.15;
    }
    renderer.render(scene, camera);
  }

  // ---- 启动 ----
  function start() {
    buildArena();
    game.drawPile = [...game.deck];
    shuffle(game.drawPile);
    drawCards(5);
    startFight();
    donateButtons('card-roguelike');
    flash('抽牌打牌，击败敌人！点击卡牌出牌');
    requestAnimationFrame(animate);
  }
  start();

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();
}
