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
  { id: 'strike', name: '打击 Strike', cost: 1, dmg: 6, type: 'atk', color: '#e8794f', desc: '造成6伤害 Deal 6 dmg' },
  { id: 'bash', name: '重击 Bash', cost: 2, dmg: 12, type: 'atk', color: '#d95e38', desc: '造成12伤害 Deal 12 dmg' },
  { id: 'guard', name: '防御 Guard', cost: 1, block: 6, type: 'def', color: '#6eb5ff', desc: '获得6护甲 Gain 6 block' },
  { id: 'iron', name: '铁壁 Iron', cost: 2, block: 12, type: 'def', color: '#4a8ac9', desc: '获得12护甲 Gain 12 block' },
  { id: 'fire', name: '火球 Fireball', cost: 2, dmg: 10, burn: 3, type: 'atk', color: '#ff6b4a', desc: '10伤害+灼烧 10dmg+burn' },
  { id: 'heal', name: '治愈 Heal', cost: 1, heal: 8, type: 'skill', color: '#6bc46b', desc: '恢复8生命 Heal 8' },
  { id: 'double', name: '双重打击 Double', cost: 1, dmg: 4, hits: 2, type: 'atk', color: '#ff9f43', desc: '4×2伤害 4×2 dmg' },
  { id: 'power', name: '蓄力 Power', cost: 1, power: 2, type: 'skill', color: '#9a6bff', desc: '力量+2 Strength +2' },
];

// 初始卡组
const START_DECK = ['strike', 'strike', 'strike', 'guard', 'guard', 'bash'];

// 敌人
const ENEMIES = [
  { name: '骷髅兵', hp: 25, dmg: 5, color: 0xcccccc, scale: 0.7, weapon: 'sword' },
  { name: '哥布林', hp: 20, dmg: 7, color: 0x6bc46b, scale: 0.7, weapon: 'axe' },
  { name: '暗影刺客', hp: 35, dmg: 9, color: 0x8a5adf, scale: 0.8, weapon: 'dagger' },
  { name: '地牢领主', hp: 60, dmg: 12, color: 0xe05a5a, scale: 1.1, weapon: 'hammer' },
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

  // ---- 武器系统（几何体，主角/敌人每关换武器）----
  const WEAPON_TYPES = {
    sword: { name: '长剑', color: 0xc0c0c0 },
    axe: { name: '巨斧', color: 0xb8a060 },
    staff: { name: '法杖', color: 0x6eb5ff },
    bow: { name: '长弓', color: 0x9a6b3f },
    dagger: { name: '匕首', color: 0x8a8a8a },
    hammer: { name: '战锤', color: 0x6a6a8a },
  };
  function buildWeapon(type) {
    const w = WEAPON_TYPES[type] || WEAPON_TYPES.sword;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: w.color, metalness: 0.6, roughness: 0.3 });
    if (type === 'staff') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), mat);
      shaft.position.y = 0.6; g.add(shaft);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x6eb5ff, transparent: true, opacity: 0.9 }));
      orb.position.y = 1.3; g.add(orb);
    } else if (type === 'bow') {
      const curve = new THREE.EllipseCurve(0, 0, 0.4, 0.55, 0, Math.PI * 2, false, 0);
      const pts = curve.getPoints(12);
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, 0)));
      const bow = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: w.color }));
      bow.position.y = 0.7; g.add(bow);
      const string = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 1.25, 0)]),
        new THREE.LineBasicMaterial({ color: 0xffffff }));
      string.position.y = 0; g.add(string);
    } else if (type === 'dagger') {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 6), mat); blade.position.y = 0.5; g.add(blade);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
      handle.position.y = 0.15; g.add(handle);
    } else if (type === 'hammer') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
      shaft.position.y = 0.4; g.add(shaft);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.25), mat); head.position.y = 0.85; g.add(head);
    } else if (type === 'axe') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
      shaft.position.y = 0.45; g.add(shaft);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.08), mat); blade.position.set(0.15, 0.8, 0); blade.rotation.z = 0.3; g.add(blade);
    } else {
      // sword
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), mat); blade.position.y = 0.6; g.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), mat); tip.position.y = 1.1; g.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x8a6a3f }));
      guard.position.y = 0.2; g.add(guard);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
      handle.position.y = 0.05; g.add(handle);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function equipWeapon(parent, type, side = 1) {
    const w = buildWeapon(type);
    w.position.set(0.4 * side, 0.9, 0);
    w.rotation.z = -0.4 * side;
    parent.add(w);
    return w;
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
    // 敌人武器（按类型）
    const enemyWeapon = t.weapon || 'sword';
    const ew = buildWeapon(enemyWeapon);
    ew.position.set(0.5, 0.6, 0);
    ew.rotation.z = -0.3;
    g.add(ew);
    g.position.set(0, 0, -2);
    g.castShadow = true;
    scene.add(g);
    return g;
  }

  const playerMesh = buildHuman();
  playerMesh.position.set(0, 0, 2);
  scene.add(playerMesh);
  let playerWeapon = null;
  function equipPlayerWeapon() {
    if (playerWeapon) playerMesh.remove(playerWeapon);
    const types = Object.keys(WEAPON_TYPES);
    const t = types[Math.floor(Math.random() * types.length)];
    playerWeapon = equipWeapon(playerMesh, t, 1);
    flash('🗡️ 获得武器：' + WEAPON_TYPES[t].name);
  }
  // equipPlayerWeapon 移到 start() 调用

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
    sfxDraw();
    game.phase = 'player';
    renderHand();
    updateHUD();
  }
  function startFight() {
    equipPlayerWeapon();  // 每关换玩家武器
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
    sfxCard();
    // 效果
    const dmg = (card.dmg || 0) + game.power;
    if (card.dmg) {
      const total = card.hits ? dmg * card.hits : dmg;
      game.enemy.hp -= total;
      sfxHit();
      hitFloat(-total);
      enemyHitAnim();
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
    sfxWin();
    flash(`💀 ${killed.name} 被击败！`);
    setTimeout(() => showReward(), 800 / SPEED);
  }
  function enemyTurn() {
    if (game.over || !game.enemy) return;
    game.phase = 'enemy';
    sfxEnemy();
    flash('👾 ' + game.enemy.name + ' 的回合！');
    // 敌人攻击动画（发光+前冲）
    if (game.enemy.mesh) {
      const m = game.enemy.mesh;
      m.material && (m.material.emissiveIntensity = 1);
      const t0 = performance.now();
      const id = setInterval(() => {
        const t = (performance.now() - t0) / 300;
        if (t >= 1) { clearInterval(id); m.position.set(0, 0, -2); return; }
        m.position.z = -2 + t * 1.5;
      }, 16 / SPEED);
    }
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
  function enemyHitAnim() {
    if (!game.enemy || !game.enemy.mesh) return;
    const m = game.enemy.mesh;
    m.scale.set(1.2, 0.8, 1.2);
    setTimeout(() => { m.scale.set(1, 1, 1); }, 250 / SPEED);
  }

  function weaponSwing() {
    if (!playerWeapon) return;
    const w = playerWeapon;
    const origRot = { z: w.rotation.z, y: w.rotation.y };
    const t0 = performance.now();
    // 挥动：旋转 180° 后复位
    const id = setInterval(() => {
      const t = (performance.now() - t0) / 300;
      if (t >= 1) {
        clearInterval(id);
        w.rotation.z = origRot.z; w.rotation.y = origRot.y;
        return;
      }
      w.rotation.z = origRot.z + (1 - t) * Math.PI;
      w.rotation.y = origRot.y + Math.sin(t * Math.PI) * 1.2;
    }, 16 / SPEED);
  }

  function attackBeam() {
    if (!game.enemy || !game.enemy.mesh) return;
    const start = new THREE.Vector3(0, 1.2, 2);
    const end = new THREE.Vector3(0, 0.8, -2);
    // 光束（多根+粗圆管）
    for (let i = -1; i <= 1; i++) {
      const s2 = new THREE.Vector3(start.x + i * 0.15, start.y + i * 0.1, start.z);
      const e2 = new THREE.Vector3(end.x + i * 0.15, end.y + i * 0.1, end.z);
      const geo = new THREE.BufferGeometry().setFromPoints([s2, e2]);
      const mat = new THREE.LineBasicMaterial({ color: i === 0 ? 0xffffff : 0xffe28a, linewidth: 3 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      setTimeout(() => scene.remove(line), 350 / SPEED);
    }
    // 光球
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    ball.position.copy(start);
    scene.add(ball);
    // 动画：光球飞向敌人
    const t0 = performance.now();
    const animId = setInterval(() => {
      const t = (performance.now() - t0) / 250;
      if (t >= 1) {
        clearInterval(animId);
        scene.remove(line); scene.remove(ball);
        if (game.enemy) { enemyHitAnim(); explodeParticles(end); }
        return;
      }
      ball.position.lerpVectors(start, end, t);
    }, 16 / SPEED);
  }

  function explodeParticles(pos) {
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
        new THREE.MeshBasicMaterial({ color: [0xffd166, 0xff6b4a, 0xfff2b0][i % 3] }));
      p.position.copy(pos);
      scene.add(p);
      const vx = (Math.random() - 0.5) * 3, vy = Math.random() * 2, vz = (Math.random() - 0.5) * 3;
      const t0 = performance.now();
      const id = setInterval(() => {
        const t = (performance.now() - t0) / 400;
        if (t >= 1) { clearInterval(id); scene.remove(p); return; }
        p.position.set(pos.x + vx * t, pos.y + vy * t, pos.z + vz * t);
      }, 16 / SPEED);
    }
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
    sfxLose();
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

  function showGuide() {
    const g = document.createElement('div');
    g.id = 'guide';
    g.style.cssText = 'position:fixed;bottom:160px;left:50%;transform:translateX(-50%);background:#e8794f;color:#fff;font:bold 15px Arial;padding:10px 20px;border-radius:14px;z-index:96;box-shadow:0 3px 10px rgba(0,0,0,.4);animation:pulse 1.5s infinite';
    g.innerHTML = '👆 点击卡牌出牌！<br><span style="font-size:11px;color:#ffe28a">⚡能量够就能打</span>';
    document.body.appendChild(g);
    setTimeout(() => { const el = document.getElementById('guide'); if (el) el.remove(); }, 5000 / SPEED);
    const st = document.createElement('style');
    st.textContent = '@keyframes pulse{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.08)}}';
    document.head.appendChild(st);
  }

  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:10px;left:10px;font:bold 14px Arial;color:#fff;background:rgba(0,0,0,0.6);padding:8px 12px;border-radius:10px;z-index:95';
  document.body.appendChild(hud);
  // 结束回合按钮
  const endBtn = document.createElement('button');
  endBtn.textContent = '⏭️ 结束回合';
  endBtn.style.cssText = 'position:fixed;top:10px;right:10px;background:#e8794f;color:#fff;font:bold 15px Arial;padding:10px 18px;border:none;border-radius:12px;cursor:pointer;z-index:95;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  endBtn.onclick = () => { if (game.phase === 'player' && !game.over) { game.discardPile.push(...game.hand); game.hand = []; renderHand(); enemyTurn(); } };
  document.body.appendChild(endBtn);
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
  function sfx(freq, dur, type = 'square', vol = 0.08) {
    try {
      if (!bgm) return;
      const o = bgm.ctx.createOscillator(), g = bgm.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, bgm.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, bgm.ctx.currentTime + dur);
      o.connect(g).connect(bgm.ctx.destination);
      o.start(); o.stop(bgm.ctx.currentTime + dur);
    } catch (e) {}
  }
  // 专属音效
  const sfxCard = () => sfx(600, 0.08, 'triangle', 0.1);
  const sfxHit = () => sfx(200, 0.15, 'sawtooth', 0.12);
  const sfxEnemy = () => sfx(150, 0.3, 'sawtooth', 0.12);
  const sfxWin = () => { sfx(523, 0.2, 'triangle'); setTimeout(() => sfx(659, 0.2, 'triangle'), 120); setTimeout(() => sfx(784, 0.3, 'triangle'), 240); };
  const sfxLose = () => { sfx(200, 0.3, 'sawtooth'); setTimeout(() => sfx(150, 0.4, 'sawtooth'), 250); };
  const sfxDraw = () => sfx(880, 0.06, 'sine', 0.06);
  function startAudio() {
    if (!bgm) { bgm = new BgmPlayer(); bgm.ensure(); bgm.play(); }
    else if (bgm.ctx && bgm.ctx.state === 'suspended') bgm.ctx.resume();
  }
  renderer.domElement.addEventListener('pointerdown', startAudio);
  document.addEventListener('keydown', startAudio);
  document.addEventListener('touchstart', startAudio);
  // 首次点击卡牌也启动（兜底）
  document.addEventListener('click', () => { if (!bgm) startAudio(); }, { once: true });

  // ---- 主循环（RAF + setInterval 兜底，确保画面一定更新）----
  function tick() {
    const time = performance.now();
    const dt = Math.min(0.05, (time - game.lastTime) / 1000);
    game.lastTime = time;
    // 敌人浮动动画
    if (game.enemy && game.enemy.mesh) {
      game.enemy.mesh.position.y = Math.sin(time * 0.002) * 0.15;
    }
    renderer.render(scene, camera);
  }
  function animate() {
    requestAnimationFrame(animate);
    tick();
  }
  // 兜底：setInterval 渲染（RAF 失效时画面也动）
  setInterval(tick, 50);

  // ---- 启动 ----
  function start() {
    equipPlayerWeapon();
    buildArena();
    game.drawPile = [...game.deck];
    shuffle(game.drawPile);
    drawCards(5);
    startFight();
    donateButtons('card-roguelike');
    flash('👇 点击屏幕底部的卡牌出牌（打击/防御/技能）');
    showGuide();
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
