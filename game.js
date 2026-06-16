'use strict';
/**
 * Good Enough Garage - a tiny roguelike deckbuilder about an auto-repair shop.
 * Zero build: plain ES2020, classic script. Data flows one way:
 *   state --render(state)--> DOM --dispatch(action)--> new state --render--> ...
 *
 * @typedef {'engine'|'brakes'|'electrical'|'body'} FaultType
 * @typedef {{type:FaultType,label:string,revealed:boolean,repaired:boolean,specialtyMatch:boolean}} Fault
 * @typedef {{id:string,name:string,specialties:FaultType[]}} Mechanic
 * @typedef {{type:string,basePay:number}} Customer
 * @typedef {{id:string,model:string,customer:Customer,faults:Fault[],patience:number,maxPatience:number,rush:boolean,location:'lot'|'bay'|'shipped'|'left',isComeback:boolean}} Car
 */

(function () {
  // ===========================================================================
  // CONFIG - every tunable lives here
  // ===========================================================================
  const CONFIG = {
    daysToWin: 5,
    startTokens: 6,
    startBays: 2,
    startRep: 50,
    quotaByDay:   [120, 160, 220, 300, 400],
    lotSizeByDay: [4,   5,   5,   6,   6],
    faultCountWeights: { 1: 0.5, 2: 0.35, 3: 0.15 },
    patienceNormal: 5,
    patienceRush: 3,
    tightwadPatiencePenalty: 2,
    rushChance: 0.2,
    rushBonus: 40,
    // scoring
    faultValue: 12,
    specialtyBonus: 8,
    cleanJobMult: 0.5,
    // reputation deltas
    repCleanJob: +5,
    repComeback: -10,
    repCarLeft: -5,
    repRushHit: +5,
    repRushMissed: -8,
    // comeback
    comebackCashClawbackFraction: 1.0,
    // endless mode (past the 5-day week)
    endlessQuotaGrowth: 1.3,   // quota multiplier per day after day 5
    premiumUpgradeDay: 6,      // premium upgrades start appearing from this day
    premiumDiscount: 0.8,      // cost multiplier on offers once "Premium Parts" is unlocked
  };

  // ===========================================================================
  // CONTENT - the charm
  // ===========================================================================
  const CARS = ["'08 Civic", "'15 F-150", "'03 Beetle", "'21 Model 3", "'99 Miata", "'12 Odyssey", "'06 Corolla", "'18 Wrangler"];

  const CUSTOMERS = [
    { type: 'commuter',   basePay: 35 },
    { type: 'parent',     basePay: 45 },
    { type: 'enthusiast', basePay: 70 },
    { type: 'fleet',      basePay: 40 },
    { type: 'tightwad',   basePay: 25 },
  ];
  const CUSTOMER_NAME = { commuter: 'Commuter', parent: 'Parent', enthusiast: 'Enthusiast', fleet: 'Fleet', tightwad: 'Tightwad' };

  const FAULT_TYPES = ['engine', 'brakes', 'electrical', 'body'];
  const FAULT_LABELS = {
    engine:     ['rough idle', "won't start", 'oil leak'],
    brakes:     ['squealing', 'soft pedal', 'grinding'],
    electrical: ['dead battery', 'warning light', 'flickering dash'],
    body:       ['dented door', 'cracked bumper', 'rust spot'],
  };

  const START_MECHS = [
    { id: 'hank', name: 'Hank', specialties: ['engine', 'brakes'] },
    { id: 'rosa', name: 'Rosa', specialties: ['electrical', 'body'] },
  ];
  const HIREABLE = [
    { id: 'deb', name: 'Deb', specialties: ['engine', 'electrical'] },
    { id: 'tom', name: 'Tom', specialties: ['brakes', 'body'] },
  ];

  const UPGRADES = [
    { key: 'token',        name: 'Extra Wrench',  desc: '+1 work token every day (permanent).',       cost: 60 },
    { key: 'bay',          name: 'New Bay',       desc: '+1 bay, work more cars at once (permanent).', cost: 90 },
    { key: 'scanTool',     name: 'Scan Tool',     desc: 'Reveals ALL faults on intake. No diagnosis.', cost: 110 },
    { key: 'hireMechanic', name: 'Hire Mechanic', desc: 'Adds a random specialist to your crew.',      cost: 80 },
    { key: 'coffee',       name: 'Coffee Machine',desc: '+2 starting patience for all waiting cars.',  cost: 50 },
  ];

  // Crew flavor for the Staff menu (keyed by mechanic id).
  const MECH_BIOS = {
    hank: 'Old-school grease monkey. Engines and brakes are second nature.',
    rosa: 'Wiring and bodywork specialist with a steady hand.',
    deb:  'Diagnostics whiz across engines and electrical.',
    tom:  'Brakes and bodywork, fast and tidy.',
  };

  // "How to Play" wizard, one screen per step.
  const HOWTO_STEPS = [
    { icon: '🔧', title: 'Welcome to the garage', body: 'You run a repair shop for one week: 5 days. Each day you must earn the rent (the quota) before you close up. Miss it and you are out of business.' },
    { icon: '🚗', title: '1. Intake (free)', body: 'Tap a car in the Lot to pull it into an open Bay. Intake is free and reveals the customer complaint: one fault you can see.' },
    { icon: '🔍', title: '2. Diagnose (1 token)', body: 'Cars can hide up to 3 faults. Spend a token to uncover the next one. "No further faults found" means it is truly clean.' },
    { icon: '🛠️', title: '3. Repair (1 token)', body: 'Assign a mechanic to a revealed fault. If it matches their specialty (marked ★) you earn a bonus. See the menu > Staff for who is good at what.' },
    { icon: '✅', title: '4. Ship It (the commit)', body: 'Hand the car back and get paid. Ship a car with faults still hidden or unfixed and it pays now, but the customer returns the next day, unhappy, and you refund them. That is the gamble.' },
    { icon: '⏳', title: 'The squeeze', body: 'Tokens and bays are limited, and every token you spend makes waiting cars lose patience. Triage! Orange RUSH jobs pay extra but leave fast.' },
    { icon: '🏁', title: 'Beat the week', body: 'Meet the day quota to reach the upgrade shop, then carry on. Survive all 5 days to win the week.' },
    { icon: '♾️', title: 'Go endless', body: 'After Week 1 the shop keeps going: quotas climb, bigger power-ups appear, and you push for a high score (the cash and reputation you reach). Failing ends the run.' },
    { icon: '🏆', title: 'Unlock & return', body: 'Your best score sticks around and unlocks permanent perks for future runs. Check the menu > Progress to see what is unlocked and what is next. Good luck!' },
  ];

  // Beefier upgrades that show up once you push past the first week (or sooner with the Premium Parts unlock).
  const PREMIUM_UPGRADES = [
    { key: 'turbo',     name: 'Turbo Crew',     desc: '+2 work tokens every day (permanent).', cost: 140 },
    { key: 'expansion', name: 'Expansion Wing', desc: '+2 bays (permanent).',                  cost: 200 },
    { key: 'master',    name: 'Master Tech',    desc: 'Hire an ace with three specialties.',    cost: 170 },
  ];

  // ===========================================================================
  // META-PROGRESSION - persists across runs (localStorage). Best score unlocks perks.
  // ===========================================================================
  // Unlocks apply to the START of every future run, in order, when best score >= score.
  const UNLOCKS = [
    { key: 'coffee1', name: 'Fresh Pot',     desc: 'Start each run with +1 patience on all cars.', score: 150,  apply: (s) => { s.patienceBonus += 1; } },
    { key: 'hand1',   name: 'Extra Hand',    desc: 'Start each run with +1 work token per day.',    score: 350,  apply: (s) => { s.bonusTokens += 1; } },
    { key: 'bay1',    name: 'Roomy Garage',  desc: 'Start each run with +1 bay.',                    score: 600,  apply: (s) => { s.bays += 1; } },
    { key: 'rep1',    name: 'Good Name',     desc: 'Start each run at 60 reputation.',               score: 900,  apply: (s) => { s.rep = Math.max(s.rep, 60); } },
    { key: 'premium', name: 'Premium Parts', desc: 'Bigger upgrades appear from Day 1, and all upgrades cost less.', score: 1300, apply: (s) => { s.premium = true; } },
  ];

  const SAVE_KEY = 'geg.save.v1';

  function defaultMeta() {
    return { version: 1, best: { score: 0, cash: 0, rep: 0, day: 0 }, lifetime: { runs: 0, wins: 0 }, unlocks: {} };
  }

  function loadMeta() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const m = JSON.parse(raw);
        // shallow-merge onto defaults so older/missing fields are safe
        return Object.assign(defaultMeta(), m, {
          best: Object.assign(defaultMeta().best, m.best),
          lifetime: Object.assign(defaultMeta().lifetime, m.lifetime),
          unlocks: Object.assign({}, m.unlocks),
        });
      }
    } catch (e) { /* storage unavailable (private mode / file://); play without persistence */ }
    return defaultMeta();
  }

  function saveMeta(m) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
  }

  /** @type {any} */
  let meta = defaultMeta();

  // ===========================================================================
  // RNG - seeded mulberry32 so runs are reproducible via ?seed=
  // ===========================================================================
  let rng = Math.random;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function readSeedFromUrl() {
    const raw = new URLSearchParams(location.search).get('seed');
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? (n >>> 0) : null;
  }

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ===========================================================================
  // STATE
  // ===========================================================================
  /** @type {any} */
  let state = null;
  let carCounter = 0;
  let toastCounter = 0;

  function logEvent(msg) {
    state.log.unshift(msg);
    if (state.log.length > 30) state.log.length = 30;
  }

  function toast(msg) {
    const id = ++toastCounter;
    state.toasts.push({ id, msg });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', id }), 3800);
  }

  function changeRep(delta) {
    state.rep = Math.max(0, Math.min(100, state.rep + delta));
    if (state.rep < 1 && state.screen !== 'gameover') {
      state.screen = 'gameover';
      state.result = 'lose';
      state.loseReason = 'Your reputation hit rock bottom.';
    }
  }

  // ===========================================================================
  // GENERATION
  // ===========================================================================
  function weightedFaultCount() {
    const w = CONFIG.faultCountWeights;
    const r = rng();
    if (r < w[1]) return 1;
    if (r < w[1] + w[2]) return 2;
    return 3;
  }

  /** @returns {Car} */
  function makeCar() {
    const model = pick(CARS);
    const base = pick(CUSTOMERS);
    const customer = { type: base.type, basePay: base.basePay };
    const count = weightedFaultCount();
    const faults = [];
    for (let i = 0; i < count; i++) {
      const type = pick(FAULT_TYPES);
      const label = pick(FAULT_LABELS[type]);
      faults.push({ type, label, revealed: false, repaired: false, specialtyMatch: false });
    }
    // Parents "often" rush; everyone else uses the base chance.
    const rushChance = customer.type === 'parent' ? CONFIG.rushChance * 2 : CONFIG.rushChance;
    const rush = rng() < rushChance;
    let patience = rush ? CONFIG.patienceRush : CONFIG.patienceNormal;
    if (customer.type === 'tightwad') patience = Math.max(2, patience - CONFIG.tightwadPatiencePenalty);
    patience += state.patienceBonus;
    carCounter++;
    return {
      id: 'c' + carCounter, model, customer, faults,
      patience, maxPatience: patience, rush,
      location: 'lot', isComeback: false,
    };
  }

  function generateLot(size) {
    const lot = [];
    for (let i = 0; i < size; i++) lot.push(makeCar());
    return lot;
  }

  // ===========================================================================
  // SCORING (pure)
  // ===========================================================================
  /** @param {Car} car */
  function computeShip(car) {
    let chips = car.customer.basePay;
    for (const f of car.faults) {
      if (f.repaired) {
        chips += CONFIG.faultValue;
        if (f.specialtyMatch) chips += CONFIG.specialtyBonus;
      }
    }
    const clean = car.faults.every((f) => f.repaired);
    const dirty = car.faults.some((f) => !f.repaired);
    const mult = 1 + (clean ? CONFIG.cleanJobMult : 0);
    return { base: Math.round(chips * mult), clean, dirty };
  }

  // ===========================================================================
  // ACTIONS - the only place state changes
  // ===========================================================================
  function intake(carId) {
    if (state.inBays.length >= state.bays) return;
    const idx = state.lot.findIndex((c) => c.id === carId);
    if (idx < 0) return;
    const car = state.lot.splice(idx, 1)[0];
    car.location = 'bay';
    car.faults[0].revealed = true; // the complaint is now a known fault
    if (state.hasScanTool) car.faults.forEach((f) => (f.revealed = true));
    state.inBays.push(car);
    logEvent(`Intake: ${car.model} (${CUSTOMER_NAME[car.customer.type]}), complaint "${car.faults[0].label}".`);
  }

  /** A "tick" - happens whenever a real token is spent. Lot patience drains. */
  function tick() {
    for (const car of state.lot) car.patience--;
    const leaving = state.lot.filter((c) => c.patience <= 0);
    for (const car of leaving) {
      car.location = 'left';
      changeRep(car.rush ? CONFIG.repRushMissed : CONFIG.repCarLeft);
      logEvent(`${car.model} got tired of waiting and left.`);
      if (car.rush) toast(`Lost a rush job: the ${car.model} drove off!`);
    }
    if (leaving.length) state.lot = state.lot.filter((c) => c.patience > 0);
  }

  function diagnose(carId) {
    const car = state.inBays.find((c) => c.id === carId);
    if (!car) return;
    const free = car.isComeback;
    if (!free && state.tokensLeft < 1) return;
    const hidden = car.faults.find((f) => !f.revealed);
    if (hidden) {
      hidden.revealed = true;
      logEvent(`Diagnosed ${car.model}: found ${hidden.label} (${hidden.type}).`);
    } else {
      logEvent(`Diagnosed ${car.model}: no further faults found. It is clean.`);
    }
    if (!free) { state.tokensLeft--; tick(); }
  }

  function repair(carId, index, mechId) {
    const car = state.inBays.find((c) => c.id === carId);
    if (!car) return;
    const f = car.faults[index];
    if (!f || !f.revealed || f.repaired) return;
    const free = car.isComeback;
    if (!free && state.tokensLeft < 1) return;
    const mech = state.mechanics.find((m) => m.id === mechId);
    if (!mech) return;
    f.repaired = true;
    f.specialtyMatch = mech.specialties.includes(f.type);
    state.pickerFor = null;
    logEvent(`${mech.name} fixed ${f.label} on ${car.model}${f.specialtyMatch ? ' (specialty!)' : ''}.`);
    if (!free) { state.tokensLeft--; tick(); }
  }

  /** Ship It - the commit. */
  function shipCar(car) {
    const r = computeShip(car);
    if (car.isComeback) {
      // Already paid on the first (dirty) ship; this is free rework, no charge.
      logEvent(`Comeback sorted: ${car.model}${r.clean ? ' (done right this time)' : ' sent back out'}, no charge.`);
      if (r.clean) changeRep(CONFIG.repCleanJob);
    } else {
      let payout = r.base;
      if (car.rush) { payout += CONFIG.rushBonus; changeRep(CONFIG.repRushHit); }
      if (r.clean) changeRep(CONFIG.repCleanJob);
      state.cash += payout;
      state.dayRevenue += payout;
      logEvent(`Shipped ${car.model}: +$${payout}${r.clean ? ' clean!' : ''}${car.rush ? ' rush!' : ''}.`);
    }
    if (r.dirty) {
      car.isComeback = true; // returns to bite you next day
      state.pendingComebacks.push(car);
      logEvent(`Heads up: ${car.model} went out with work undone.`);
    }
    car.location = 'shipped';
    state.inBays = state.inBays.filter((c) => c.id !== car.id);
  }

  function shipFromBay(carId) {
    const car = state.inBays.find((c) => c.id === carId);
    if (car) shipCar(car);
  }

  // Day scaling: fixed for the first week, then it keeps climbing (endless mode).
  function quotaForDay(day) {
    const q = CONFIG.quotaByDay;
    if (day <= q.length) return q[day - 1];
    let v = q[q.length - 1];
    for (let d = q.length + 1; d <= day; d++) v = Math.round(v * CONFIG.endlessQuotaGrowth);
    return v;
  }

  function lotForDay(day) {
    const l = CONFIG.lotSizeByDay;
    if (day <= l.length) return l[day - 1];
    return Math.min(8, l[l.length - 1] + Math.floor((day - l.length) / 2));
  }

  // High score = the cash and reputation you reached, plus a bonus for how deep you got.
  function runScore() {
    return Math.max(0, state.peakCash) + state.peakRep + (state.day - 1) * 20;
  }

  function trackPeaks() {
    if (!state) return;
    if (state.cash > state.peakCash) state.peakCash = state.cash;
    if (state.rep > state.peakRep) state.peakRep = state.rep;
  }

  // Called once when a run ends: bank the high score and award any newly earned unlocks.
  function finalizeRun() {
    if (state.finalized) return;
    state.finalized = true;
    trackPeaks();
    state.result = state.weekSurvived ? 'win' : 'lose';
    state.finalScore = runScore();

    meta.lifetime.runs += 1;
    if (state.weekSurvived) meta.lifetime.wins += 1;

    state.newBest = state.finalScore > meta.best.score;
    if (state.finalScore > meta.best.score) meta.best.score = state.finalScore;
    if (state.peakCash > meta.best.cash) meta.best.cash = state.peakCash;
    if (state.peakRep > meta.best.rep) meta.best.rep = state.peakRep;
    if (state.day > meta.best.day) meta.best.day = state.day;

    state.newlyUnlocked = [];
    for (const u of UNLOCKS) {
      if (!meta.unlocks[u.key] && meta.best.score >= u.score) {
        meta.unlocks[u.key] = true;
        state.newlyUnlocked.push({ key: u.key, name: u.name, desc: u.desc });
        toast(`Unlocked: ${u.name}!`);
      }
    }
    saveMeta(meta);
  }

  function endDay() {
    // Cars still in bays get auto-shipped as-is (risking comebacks).
    for (const car of state.inBays.slice()) shipCar(car);
    // Cars still waiting in the lot are lost.
    for (const car of state.lot.slice()) {
      car.location = 'left';
      changeRep(car.rush ? CONFIG.repRushMissed : CONFIG.repCarLeft);
      logEvent(`${car.model} gave up waiting and left the lot.`);
    }
    state.lot = [];

    if (state.screen === 'gameover') return; // rep already bottomed out

    if (state.dayRevenue >= state.quota) {
      // Clearing day 5 wins the week, but the run keeps going (endless).
      if (state.day === CONFIG.daysToWin && !state.weekSurvived) {
        state.weekSurvived = true;
        toast('You survived the week! Keep going for a high score.');
      }
      state.shopOffers = makeShopOffers();
      state.boughtThisShop = [];
      state.pickerFor = null;
      state.screen = 'shop';
    } else {
      state.screen = 'gameover';
      state.loseReason = `Couldn't make rent on Day ${state.day}.`;
    }
  }

  function makeShopOffers() {
    const owned = state.mechanics.map((m) => m.id);
    const hireLeft = HIREABLE.filter((m) => !owned.includes(m.id));
    let pool = UPGRADES.filter((u) => {
      if (u.key === 'scanTool' && state.hasScanTool) return false;
      if (u.key === 'hireMechanic' && hireLeft.length === 0) return false;
      return true;
    });
    // Bigger power-ups once you push past the week (or with the Premium Parts unlock).
    if (state.premium || state.day >= CONFIG.premiumUpgradeDay) {
      pool = pool.concat(PREMIUM_UPGRADES);
    }
    const offers = shuffle(pool.slice()).slice(0, 3);
    // Clone so we can apply the premium discount without mutating the source tables.
    return offers.map((u) => ({
      key: u.key,
      name: u.name,
      desc: u.desc,
      cost: state.premium ? Math.round(u.cost * CONFIG.premiumDiscount) : u.cost,
    }));
  }

  function buyUpgrade(key) {
    if (state.boughtThisShop.includes(key)) return;
    const u = state.shopOffers.find((o) => o.key === key);
    if (!u || state.cash < u.cost) return;
    state.cash -= u.cost;
    state.boughtThisShop.push(key);
    applyUpgrade(key);
    logEvent(`Bought ${u.name} for $${u.cost}.`);
  }

  function applyUpgrade(key) {
    if (key === 'token') state.bonusTokens += 1;
    else if (key === 'bay') state.bays += 1;
    else if (key === 'scanTool') state.hasScanTool = true;
    else if (key === 'coffee') state.patienceBonus += 2;
    else if (key === 'hireMechanic') {
      const owned = state.mechanics.map((m) => m.id);
      const left = HIREABLE.filter((m) => !owned.includes(m.id));
      if (left.length) {
        const m = pick(left);
        state.mechanics.push({ id: m.id, name: m.name, specialties: m.specialties.slice() });
        logEvent(`Hired ${m.name} (${m.specialties.join('/')}).`);
      }
    }
    else if (key === 'turbo') state.bonusTokens += 2;
    else if (key === 'expansion') state.bays += 2;
    else if (key === 'master') {
      const specialties = shuffle(FAULT_TYPES.slice()).slice(0, 3);
      const names = ['Ace', 'Sam', 'Jo', 'Kai', 'Lou', 'Max'];
      const used = state.mechanics.map((m) => m.name);
      const name = names.find((n) => !used.includes(n)) || ('Tech ' + (state.mechanics.length + 1));
      state.mechanics.push({ id: 'master' + state.mechanics.length, name, specialties });
      logEvent(`Hired master tech ${name} (${specialties.join('/')}).`);
    }
  }

  function advanceDay() {
    state.day += 1;
    state.quota = quotaForDay(state.day);
    state.dayRevenue = 0;
    state.tokensLeft = CONFIG.startTokens + state.bonusTokens;
    state.pickerFor = null;
    state.boughtThisShop = [];
    state.shopOffers = [];
    state.screen = 'floor';

    const lot = generateLot(lotForDay(state.day));
    // Returning comebacks are prepended and apply their penalties on arrival.
    const returning = state.pendingComebacks;
    state.pendingComebacks = [];
    for (const car of returning) {
      changeRep(CONFIG.repComeback);
      const refund = Math.round(car.customer.basePay * CONFIG.comebackCashClawbackFraction);
      state.cash -= refund;
      car.location = 'lot';
      car.rush = false;
      car.isComeback = true;
      car.patience = car.maxPatience = CONFIG.patienceNormal + state.patienceBonus;
      logEvent(`${car.model} came back: refunded $${refund}, reputation took a hit.`);
      toast(`Comeback! The ${car.model} is back, and not happy.`);
      lot.unshift(car);
    }
    state.lot = lot;
    logEvent(`Day ${state.day}: ${state.lot.length} cars in the lot. Quota $${state.quota}.`);
  }

  // ===========================================================================
  // NEW GAME
  // ===========================================================================
  function newGame(seedArg) {
    let seed = (seedArg === undefined || seedArg === null) ? readSeedFromUrl() : (Number(seedArg) >>> 0);
    if (seed === null || seed === undefined || Number.isNaN(seed)) {
      seed = (Math.floor(Math.random() * 1e9)) >>> 0; // no seed given: pick one and show it
    }
    rng = mulberry32(seed);
    carCounter = 0;

    state = {
      seed,
      day: 1,
      screen: 'floor',
      bonusTokens: 0,
      bays: CONFIG.startBays,
      tokensLeft: CONFIG.startTokens,
      cash: 0,
      dayRevenue: 0,
      quota: quotaForDay(1),
      rep: CONFIG.startRep,
      mechanics: START_MECHS.map((m) => ({ id: m.id, name: m.name, specialties: m.specialties.slice() })),
      hasScanTool: false,
      patienceBonus: 0,
      premium: false,
      lot: [],
      inBays: [],
      pendingComebacks: [],
      shopOffers: [],
      boughtThisShop: [],
      log: [],
      toasts: [],
      pickerFor: null,
      menuOpen: false,
      modal: null,       // null | 'staff' | 'howto' | 'unlocks'
      howtoStep: 0,
      resetArmed: false,
      // run scoring + endless
      peakCash: 0,
      peakRep: 0,
      weekSurvived: false,
      finalized: false,
      finalScore: 0,
      newBest: false,
      newlyUnlocked: [],
      result: undefined,
      loseReason: '',
    };

    // Apply persistent unlocks to the starting state, then derive dependent values.
    for (const u of UNLOCKS) if (meta.unlocks[u.key]) u.apply(state);
    state.tokensLeft = CONFIG.startTokens + state.bonusTokens;
    state.peakCash = state.cash;
    state.peakRep = state.rep;

    state.lot = generateLot(lotForDay(1));
    logEvent(`Day 1: ${state.lot.length} cars in the lot. Quota $${state.quota}.`);
    render();
  }

  // ===========================================================================
  // DISPATCH - apply an action, then re-render
  // ===========================================================================
  function dispatch(action) {
    switch (action.type) {
      case 'INTAKE': intake(action.carId); break;
      case 'DIAGNOSE': diagnose(action.carId); break;
      case 'OPEN_PICKER': state.pickerFor = (state.pickerFor === action.key ? null : action.key); break;
      case 'REPAIR': repair(action.carId, action.index, action.mechId); break;
      case 'SHIP': shipFromBay(action.carId); break;
      case 'END_DAY': endDay(); break;
      case 'BUY': buyUpgrade(action.key); break;
      case 'CONTINUE': advanceDay(); break;
      case 'RESTART': newGame(); return; // newGame renders itself
      case 'REMOVE_TOAST': state.toasts = state.toasts.filter((t) => t.id !== action.id); break;
      case 'TOGGLE_MENU': state.menuOpen = !state.menuOpen; break;
      case 'CLOSE_MENU': state.menuOpen = false; break;
      case 'OPEN_MODAL': state.modal = action.name; state.menuOpen = false; state.resetArmed = false; if (action.name === 'howto') state.howtoStep = 0; break;
      case 'CLOSE_MODAL': state.modal = null; state.resetArmed = false; break;
      case 'HOWTO_NEXT': state.howtoStep = Math.min(HOWTO_STEPS.length - 1, state.howtoStep + 1); break;
      case 'HOWTO_PREV': state.howtoStep = Math.max(0, state.howtoStep - 1); break;
      case 'ARM_RESET': state.resetArmed = !state.resetArmed; break;
      case 'RESET_META': meta = defaultMeta(); saveMeta(meta); state.resetArmed = false; break;
      default: return;
    }
    trackPeaks();
    if (state.screen === 'gameover') finalizeRun();
    render();
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) {
          if (k === 'disabled') continue; // falsy disabled = not disabled
          continue;
        }
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'disabled') e.setAttribute('disabled', '');
        else if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else e.setAttribute(k, v);
      }
    }
    const kids = Array.isArray(children) ? children : (children == null ? [] : [children]);
    for (const c of kids) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  const custLine = (c) => `${CUSTOMER_NAME[c.customer.type]} · base $${c.customer.basePay}`;

  function carBadges(car) {
    const b = [];
    if (car.rush) b.push(el('span', { class: 'badge rush-badge', text: 'RUSH' }));
    if (car.isComeback) b.push(el('span', { class: 'badge comeback-badge', text: 'COMEBACK' }));
    return b;
  }

  function typeBadge(type) {
    return el('span', { class: 'type-badge type-' + type, text: type });
  }

  function statItem(testid, label, value, danger) {
    return el('div', { 'data-testid': testid, class: 'stat' + (danger ? ' danger' : '') }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: String(value) }),
    ]);
  }

  function renderHeader() {
    return el('header', { class: 'app-header' }, [
      el('div', { class: 'brand' }, [
        el('span', { class: 'brand-name', text: 'Good Enough Garage' }),
        el('div', { class: 'menu-wrap' }, [
          el('button', { 'data-testid': 'btn-menu', class: 'btn-menu', 'aria-label': 'Menu', text: '☰', onclick: () => dispatch({ type: 'TOGGLE_MENU' }) }),
          state.menuOpen ? renderMenu() : null,
        ]),
      ]),
      el('div', { class: 'statbar' }, [
        statItem('stat-day', 'Day', `${state.day}/${CONFIG.daysToWin}`),
        statItem('stat-cash', 'Cash', `$${state.cash}`),
        statItem('stat-quota', 'Quota', `$${state.quota}`),
        statItem('stat-revenue', 'Revenue', `$${state.dayRevenue}`),
        statItem('stat-tokens', 'Tokens', `${state.tokensLeft}`),
        statItem('stat-rep', 'Rep', `${state.rep}`, state.rep < 25),
        statItem('stat-seed', 'Seed', `${state.seed}`),
      ]),
    ]);
  }

  function renderPatience(car) {
    const pct = Math.max(0, Math.min(1, car.patience / car.maxPatience)) * 100;
    return el('div', { class: 'patience' }, [
      el('span', { class: 'p-label', text: `Patience ${car.patience}/${car.maxPatience}` }),
      el('div', { class: 'p-bar' }, [
        el('div', { class: 'p-fill' + (car.patience <= 2 ? ' low' : ''), style: `width:${pct}%` }),
      ]),
    ]);
  }

  function renderLotCard(car) {
    const bayFull = state.inBays.length >= state.bays;
    return el('div', { 'data-testid': 'lot-car-' + car.id, class: 'card car' + (car.rush ? ' rush' : '') + (car.isComeback ? ' comeback' : '') }, [
      el('div', { class: 'car-top' }, [el('span', { class: 'car-model', text: car.model })].concat(carBadges(car))),
      el('div', { class: 'car-sub', text: custLine(car) }),
      el('div', { class: 'complaint' }, ['Complaint: ', el('em', { text: `“${car.faults[0].label}”` })]),
      car.rush ? el('div', { class: 'rush-line', text: 'Need it back today, family vacation!' }) : null,
      car.isComeback ? el('div', { class: 'rush-line', text: 'Back again, and not happy.' }) : null,
      renderPatience(car),
      el('button', {
        'data-testid': 'btn-intake-' + car.id, class: 'btn btn-intake',
        disabled: bayFull, text: bayFull ? 'Bays full' : 'Intake (free)',
        onclick: () => dispatch({ type: 'INTAKE', carId: car.id }),
      }),
    ]);
  }

  function renderLot() {
    const cards = state.lot.map(renderLotCard);
    return el('section', { 'data-testid': 'lot', class: 'panel lot' }, [
      el('h2', { class: 'panel-title' }, ['Lot ', el('span', { class: 'count', text: `(${state.lot.length})` })]),
      el('div', { class: 'cards' }, cards.length ? cards : [el('p', { class: 'empty', text: 'Lot is empty.' })]),
    ]);
  }

  function renderFaultRow(car, f, i, canToken) {
    const tid = 'fault-' + car.id + '-' + i;
    if (!f.revealed) {
      return el('div', { 'data-testid': tid, class: 'fault hidden' }, [
        el('span', { class: 'f-q', text: '???' }),
        el('span', { class: 'f-hint', text: 'hidden fault' }),
      ]);
    }
    if (f.repaired) {
      return el('div', { 'data-testid': tid, class: 'fault repaired' }, [
        el('span', { class: 'f-check', text: '✓' }),
        el('span', { class: 'f-label', text: f.label }),
        typeBadge(f.type),
        f.specialtyMatch ? el('span', { class: 'f-spec', text: 'specialty' }) : null,
      ]);
    }
    // revealed but unrepaired
    const key = car.id + '#' + i;
    const open = state.pickerFor === key;
    const row = el('div', { 'data-testid': tid, class: 'fault open' }, [
      el('span', { class: 'f-label', text: f.label }),
      typeBadge(f.type),
      el('button', {
        'data-testid': 'btn-repair-' + car.id + '-' + i, class: 'btn btn-repair',
        disabled: !canToken, text: open ? 'Pick mechanic' : 'Repair',
        onclick: () => dispatch({ type: 'OPEN_PICKER', key }),
      }),
    ]);
    if (open && canToken) {
      const picker = el('div', { class: 'mech-picker' }, state.mechanics.map((m) => {
        const match = m.specialties.includes(f.type);
        return el('button', {
          'data-testid': 'mech-' + car.id + '-' + i + '-' + m.id, class: 'btn mech' + (match ? ' match' : ''),
          text: m.name + (match ? ' ★' : ''),
          onclick: () => dispatch({ type: 'REPAIR', carId: car.id, index: i, mechId: m.id }),
        });
      }));
      return el('div', { class: 'fault-wrap' }, [row, picker]);
    }
    return row;
  }

  function renderBayCard(car) {
    const free = car.isComeback;
    const canToken = free || state.tokensLeft >= 1;
    return el('div', { 'data-testid': 'bay-car-' + car.id, class: 'card car in-bay' + (car.rush ? ' rush' : '') + (car.isComeback ? ' comeback' : '') }, [
      el('div', { class: 'car-top' }, [el('span', { class: 'car-model', text: car.model })].concat(carBadges(car))),
      el('div', { class: 'car-sub', text: custLine(car) }),
      el('div', { class: 'faults' }, car.faults.map((f, i) => renderFaultRow(car, f, i, canToken))),
      el('div', { class: 'bay-actions' }, [
        el('button', {
          'data-testid': 'btn-diagnose-' + car.id, class: 'btn btn-diagnose',
          disabled: !canToken, text: free ? 'Diagnose (free)' : 'Diagnose (1)',
          onclick: () => dispatch({ type: 'DIAGNOSE', carId: car.id }),
        }),
        el('button', {
          'data-testid': 'btn-ship-' + car.id, class: 'btn btn-ship', text: 'Ship It',
          onclick: () => dispatch({ type: 'SHIP', carId: car.id }),
        }),
      ]),
    ]);
  }

  function renderBays() {
    const cards = state.inBays.map(renderBayCard);
    return el('section', { 'data-testid': 'bays', class: 'panel bays' }, [
      el('h2', { class: 'panel-title' }, ['Bays ', el('span', { class: 'count', text: `(${state.inBays.length}/${state.bays})` })]),
      el('div', { class: 'cards' }, cards.length ? cards : [el('p', { class: 'empty', text: 'No cars in the bays. Intake one from the lot.' })]),
    ]);
  }

  function renderLog() {
    return el('section', { 'data-testid': 'log', class: 'panel log' }, [
      el('h2', { class: 'panel-title', text: 'Log' }),
      el('div', { class: 'log-list' }, state.log.slice(0, 5).map((line) => el('div', { class: 'log-line', text: line }))),
    ]);
  }

  function renderFloor() {
    return el('div', { class: 'floor' }, [
      el('p', { class: 'help', text: 'Intake a car, diagnose to uncover hidden faults, repair them, then Ship It when you decide it is good enough.' }),
      el('div', { class: 'floor-cols' }, [renderLot(), renderBays()]),
      el('div', { class: 'floor-actions' }, [
        el('button', { 'data-testid': 'btn-end-day', class: 'btn btn-end', text: 'Close Shop', onclick: () => dispatch({ type: 'END_DAY' }) }),
      ]),
      renderLog(),
    ]);
  }

  function renderShopCard(u) {
    const bought = state.boughtThisShop.includes(u.key);
    const afford = state.cash >= u.cost;
    return el('div', { 'data-testid': 'upgrade-' + u.key, class: 'card upgrade' + (bought ? ' bought' : '') }, [
      el('div', { class: 'up-name', text: u.name }),
      el('div', { class: 'up-desc', text: u.desc }),
      el('div', { class: 'up-cost', text: '$' + u.cost }),
      el('button', {
        'data-testid': 'btn-buy-' + u.key, class: 'btn btn-buy',
        disabled: bought || !afford, text: bought ? 'Owned' : (afford ? 'Buy' : 'Too pricey'),
        onclick: () => dispatch({ type: 'BUY', key: u.key }),
      }),
    ]);
  }

  function renderShop() {
    return el('div', { class: 'shop' }, [
      el('h2', { class: 'screen-title', text: `Day ${state.day} cleared!` }),
      el('p', { class: 'help', text: `You have $${state.cash} in the bank. Buy upgrades, then continue to Day ${state.day + 1}.` }),
      el('div', { class: 'shop-cards' }, state.shopOffers.map(renderShopCard)),
      el('button', { 'data-testid': 'btn-continue', class: 'btn btn-primary', text: `Continue to Day ${state.day + 1}`, onclick: () => dispatch({ type: 'CONTINUE' }) }),
    ]);
  }

  function renderGameOver() {
    const win = state.result === 'win';
    const msg = win
      ? (state.day > CONFIG.daysToWin ? `You beat the week and pushed to Day ${state.day}!` : 'You survived the week!')
      : (state.loseReason || `Couldn't make rent on Day ${state.day}.`);
    const stat = (label, value) => el('div', { class: 'score-stat' }, [
      el('span', { class: 'score-num', text: String(value) }),
      el('span', { class: 'score-label', text: label }),
    ]);
    const children = [
      el('h1', { class: 'go-title ' + (win ? 'win' : 'lose'), text: win ? '🏁 You beat the week!' : 'Game Over' }),
      el('p', { 'data-testid': 'gameover-result', class: 'go-result', text: msg }),
      el('div', { 'data-testid': 'final-score', class: 'final-score' + (state.newBest ? ' newbest' : '') }, [
        el('span', { class: 'fs-num', text: String(state.finalScore) }),
        el('span', { class: 'fs-label', text: state.newBest ? 'NEW HIGH SCORE!' : `Score (best ${meta.best.score})` }),
      ]),
      el('div', { 'data-testid': 'go-summary', class: 'score-grid' }, [
        stat('Day reached', state.day),
        stat('Peak cash', '$' + state.peakCash),
        stat('Peak rep', state.peakRep),
      ]),
    ];
    if (state.newlyUnlocked && state.newlyUnlocked.length) {
      children.push(el('div', { 'data-testid': 'go-unlocks', class: 'go-unlocks' }, [
        el('div', { class: 'go-unlocks-title', text: '🎉 New unlocks for next run' }),
      ].concat(state.newlyUnlocked.map((u) => el('div', { class: 'go-unlock', text: `${u.name}: ${u.desc}` })))));
    }
    children.push(el('div', { class: 'go-actions' }, [
      el('button', { 'data-testid': 'btn-restart', class: 'btn btn-primary', text: 'Play Again', onclick: () => dispatch({ type: 'RESTART' }) }),
      el('button', { 'data-testid': 'btn-gameover-progress', class: 'btn', text: '🏆 Progress', onclick: () => dispatch({ type: 'OPEN_MODAL', name: 'unlocks' }) }),
    ]));
    return el('div', { class: 'gameover' }, children);
  }

  function renderMenu() {
    return el('div', { 'data-testid': 'menu', class: 'menu-dropdown' }, [
      el('button', { 'data-testid': 'btn-menu-staff', class: 'menu-item', text: '👥 Staff', onclick: () => dispatch({ type: 'OPEN_MODAL', name: 'staff' }) }),
      el('button', { 'data-testid': 'btn-menu-progress', class: 'menu-item', text: '🏆 Progress', onclick: () => dispatch({ type: 'OPEN_MODAL', name: 'unlocks' }) }),
      el('button', { 'data-testid': 'btn-menu-howto', class: 'menu-item', text: '❓ How to Play', onclick: () => dispatch({ type: 'OPEN_MODAL', name: 'howto' }) }),
    ]);
  }

  function renderStaffBody() {
    const rows = state.mechanics.map((m) => el('div', { 'data-testid': 'staff-' + m.id, class: 'staff-row' }, [
      el('div', { class: 'staff-top' }, [
        el('span', { class: 'staff-name', text: m.name }),
        el('span', { class: 'staff-specs' }, m.specialties.map(typeBadge)),
      ]),
      el('div', { class: 'staff-bio', text: MECH_BIOS[m.id] || 'A reliable member of the crew.' }),
    ]));

    const tools = [`Bays: ${state.bays}`, `Tokens per day: ${CONFIG.startTokens + state.bonusTokens}`];
    if (state.hasScanTool) tools.push('Scan Tool');
    if (state.patienceBonus > 0) tools.push(`Coffee: +${state.patienceBonus} patience`);

    return [
      el('p', { class: 'modal-sub', text: 'Your mechanics and what they are best at. Match a mechanic to a fault of their specialty (★) for a bonus.' }),
      el('div', { class: 'staff-list' }, rows),
      el('p', { class: 'modal-sub staff-tools-title', text: 'Your garage' }),
      el('div', { class: 'staff-tools' }, tools.map((t) => el('span', { class: 'tool-chip', text: t }))),
      el('p', { class: 'modal-hint', text: 'Hire more specialists and buy tools in the shop between days.' }),
    ];
  }

  function renderHowtoBody() {
    const i = state.howtoStep;
    const step = HOWTO_STEPS[i];
    const last = i === HOWTO_STEPS.length - 1;
    return [
      el('div', { 'data-testid': 'howto-step', class: 'howto-step' }, [
        el('div', { class: 'howto-icon', text: step.icon }),
        el('h3', { class: 'howto-title', text: step.title }),
        el('p', { class: 'howto-body', text: step.body }),
      ]),
      el('div', { class: 'howto-dots' }, HOWTO_STEPS.map((_, k) => el('span', { class: 'dot' + (k === i ? ' on' : '') }))),
      el('div', { class: 'howto-nav' }, [
        el('button', { 'data-testid': 'btn-howto-prev', class: 'btn', disabled: i === 0, text: 'Back', onclick: () => dispatch({ type: 'HOWTO_PREV' }) }),
        el('span', { class: 'howto-count', text: `${i + 1} / ${HOWTO_STEPS.length}` }),
        last
          ? el('button', { 'data-testid': 'btn-howto-done', class: 'btn btn-primary howto-done', text: 'Got it!', onclick: () => dispatch({ type: 'CLOSE_MODAL' }) })
          : el('button', { 'data-testid': 'btn-howto-next', class: 'btn btn-primary howto-done', text: 'Next', onclick: () => dispatch({ type: 'HOWTO_NEXT' }) }),
      ]),
    ];
  }

  function renderUnlocksBody() {
    const stat = (label, value) => el('div', { class: 'score-stat' }, [
      el('span', { class: 'score-num', text: String(value) }),
      el('span', { class: 'score-label', text: label }),
    ]);
    const rows = UNLOCKS.map((u) => {
      const owned = !!meta.unlocks[u.key];
      return el('div', { 'data-testid': 'unlock-' + u.key, class: 'unlock-row' + (owned ? ' owned' : '') }, [
        el('div', { class: 'unlock-top' }, [
          el('span', { class: 'unlock-name', text: (owned ? '✓ ' : '🔒 ') + u.name }),
          el('span', { class: 'unlock-req', text: owned ? 'Unlocked' : `Score ${u.score}` }),
        ]),
        el('div', { class: 'unlock-desc', text: u.desc }),
        owned ? null : el('div', { class: 'unlock-prog' }, [
          el('div', { class: 'unlock-prog-fill', style: `width:${Math.min(100, Math.round(meta.best.score / u.score * 100))}%` }),
        ]),
      ]);
    });
    return [
      el('p', { class: 'modal-sub', text: 'Your high score is the cash and reputation you reach in a run. Beat it to unlock perks that carry into every future run.' }),
      el('div', { 'data-testid': 'score-grid', class: 'score-grid' }, [
        stat('Best score', meta.best.score),
        stat('Best cash', '$' + meta.best.cash),
        stat('Best rep', meta.best.rep),
        stat('Best day', meta.best.day),
        stat('Runs', meta.lifetime.runs),
        stat('Weeks won', meta.lifetime.wins),
      ]),
      el('p', { class: 'modal-sub staff-tools-title', text: 'Unlocks' }),
      el('div', { class: 'unlock-list' }, rows),
      el('div', { class: 'reset-row' }, [
        el('button', {
          'data-testid': 'btn-reset-progress', class: 'btn modal-close reset-btn' + (state.resetArmed ? ' armed' : ''),
          text: state.resetArmed ? 'Tap again to erase everything' : 'Reset progress',
          onclick: () => dispatch({ type: state.resetArmed ? 'RESET_META' : 'ARM_RESET' }),
        }),
      ]),
    ];
  }

  function renderModal() {
    if (!state.modal) return null;
    const title = state.modal === 'staff' ? 'Your Crew' : (state.modal === 'unlocks' ? 'Your Progress' : 'How to Play');
    const body = state.modal === 'staff' ? renderStaffBody() : (state.modal === 'unlocks' ? renderUnlocksBody() : renderHowtoBody());
    return el('div', {
      class: 'modal-backdrop',
      onclick: (e) => { if (e.target === e.currentTarget) dispatch({ type: 'CLOSE_MODAL' }); },
    }, [
      el('div', { 'data-testid': 'modal-' + state.modal, class: 'modal', role: 'dialog' }, [
        el('div', { class: 'modal-head' }, [
          el('h2', { class: 'modal-title', text: title }),
          el('button', { 'data-testid': 'btn-modal-close', class: 'modal-close', 'aria-label': 'Close', text: '✕', onclick: () => dispatch({ type: 'CLOSE_MODAL' }) }),
        ]),
        el('div', { class: 'modal-body' }, body),
      ]),
    ]);
  }

  function renderToasts() {
    return el('div', { class: 'toast-wrap' }, state.toasts.map((t) => el('div', { class: 'toast', text: t.msg })));
  }

  function render() {
    const root = document.getElementById('app');
    root.setAttribute('data-screen', state.screen);
    root.textContent = '';
    if (state.screen === 'floor') { root.appendChild(renderHeader()); root.appendChild(renderFloor()); }
    else if (state.screen === 'shop') { root.appendChild(renderHeader()); root.appendChild(renderShop()); }
    else { root.appendChild(renderGameOver()); }
    if (state.menuOpen) root.appendChild(el('div', { class: 'menu-backdrop', onclick: () => dispatch({ type: 'CLOSE_MENU' }) }));
    const modal = renderModal();
    if (modal) root.appendChild(modal);
    root.appendChild(renderToasts());
  }

  // ===========================================================================
  // DEBUG API + BOOT
  // ===========================================================================
  window.GEG = {
    getState: () => structuredClone(state),
    getMeta: () => structuredClone(meta),
    newGame: (seed) => newGame(seed),
    dispatch,
    endDay: () => dispatch({ type: 'END_DAY' }),
    addCash: (n) => { state.cash += n; trackPeaks(); render(); },
    resetMeta: () => { meta = defaultMeta(); saveMeta(meta); render(); },
    CONFIG,
  };

  meta = loadMeta();
  newGame();
})();
