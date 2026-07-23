/* =============================================================================
 * TAP WATER — VERTICAL SLICE — SIMULATION CORE  (sim.js)
 * -----------------------------------------------------------------------------
 * Environment-agnostic, deterministic, seeded simulation engine.
 * Runs in Node (module.exports) AND the browser (globalThis.TapWater).
 *
 * Canon mapping (immutable unless the docs mark it Reserved):
 *   - Decision Sheet:  1-hour internal tick; 12-hour world update; aging disabled.
 *   - Simulation Bible: L1 individuals, L3 relationships, L4/L6 community/district,
 *                       L8 knowledge, L9 identity, L10 memory; the 7-question
 *                       Decision Model; LOD (persistent vs background).
 *   - Part I: Complete Mimicry (skin contact), Imprints, identity strain,
 *             cost gradient (fatigue->overuse), suppression; permanent death.
 *   - Part IV: exposure-driven Changed methodology; demographic sampling.
 *   - Conflict Bible: conflicts from incompatible goals; 16 causes; escalation.
 *   - Quest Bible: quests are SLICES of conflicts; no markers; discovered.
 *   - Narrative Bible: rumor spread + distortion; competing truths.
 *   - Design Pillars: Identity over Power; combat is NOT a default verb here.
 *
 * All numeric constants are [SIM]/[tunable] (canon Reserved). Structure is canon.
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- utils --*/
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  function makeRng(seed) {
    const f = mulberry32(seed >>> 0);
    return {
      next: f,
      int: (n) => Math.floor(f() * n),
      pick: (arr) => arr[Math.floor(f() * arr.length)],
      chance: (p) => f() < p,
    };
  }

  /* --------------------------------------------------------------- config --*/
  const CFG = {
    POP_TOTAL: 250,
    POP_PERSISTENT: 40,
    WORLD_UPDATE_HOURS: 12,     // Decision Sheet: major world update cadence
    // need decay per hour (0..100 scale; 100 = fully met)
    DECAY: { food: 2.2, water: 3.0, rest: 1.6, safety: 0.0 },
    // Part IV exposure: municipal reliance -> chance a resident is Changed.
    // Actual susceptibility rate is a global [Reserved] knob; slice value is [SIM].
    CHANGED_BASE_RATE: 0.12,
    IMPRINT_STRAIN: 16,         // strain added per imprint carried/used
    COPY_ENERGY: 30,            // Part I cost gradient
    OVERUSE_STRAIN: 24,
    ROSTER_MAX: 6,              // selves you can hold near the surface (the rest sink)
  };

  /* ----------------------------------------------------------------- data --*/
  // Demographic sampling pools (Part IV: plurality-Latino, deeply multiethnic).
  const ETHN = [
    ['Latino', 0.49], ['White', 0.25], ['Asian', 0.15], ['Black', 0.08], ['Other', 0.03],
  ];
  const NAMES = {
    Latino: { f: ['Maria', 'Rosa', 'Valentina', 'Lucia', 'Elena', 'Sofia', 'Carmen'], m: ['Hector', 'Diego', 'Miguel', 'Jose', 'Luis', 'Cuco', 'Rafael'], l: ['Herrera', 'Ramos', 'Cruz', 'Salcedo', 'Fuentes', 'Reyes', 'Delgado'] },
    White: { f: ['Grace', 'Miriam', 'Renee', 'Kate', 'Susan'], m: ['Ray', 'Daniel', 'Marcus', 'Tom', 'Ed'], l: ['Dawson', 'Adler', 'Whitfield', 'Doyle', 'Vane'] },
    Asian: { f: ['Grace', 'Lian', 'Mai', 'Hana', 'Sun'], m: ['Sang-woo', 'Kenji', 'Minh', 'Wei', 'Sokha'], l: ['Kim', 'Chen', 'Park', 'Nguyen', 'Chan'] },
    Black: { f: ['Imani', 'Naomi', 'Dana', 'Ruth'], m: ['Elijah', 'Darnell', 'Marcus', 'Andre'], l: ['Booker', 'Woods', 'Grant', 'Okafor'] },
    Other: { f: ['Nadia', 'Ani', 'Yara'], m: ['Yusuf', 'Sami', 'Aram'], l: ['Demir', 'Haddad', 'Osei'] },
  };
  const OCC = ['care worker', 'mechanic', 'nurse', 'teacher', 'day laborer', 'shopkeeper', 'cook', 'student', 'retired', 'unemployed', 'medic', 'driver'];

  // The 8 canonical slice locations.
  const LOC_DEFS = [
    { id: 'apartments', name: 'Apartment Building', kind: 'home' },
    { id: 'market', name: 'Corner Market', kind: 'market' },
    { id: 'church', name: 'Church', kind: 'faith' },
    { id: 'garden', name: 'Community Garden', kind: 'garden' },
    { id: 'checkpoint', name: 'BER Checkpoint', kind: 'ber' },
    { id: 'council', name: 'Neighborhood Council', kind: 'council' },
    { id: 'warehouse', name: 'Warehouse', kind: 'warehouse' },
    { id: 'safehouse', name: 'Safe House', kind: 'safehouse' },
    { id: 'home', name: 'Your Room', kind: 'home_private' },   // Tales' private, unwatched space
  ];

  // 40 persistent NPCs: neighborhood residents built from Part VII ARCHETYPES
  // (NOT the county-level named Pillars, to avoid canon conflict). Each is a
  // distinct answer to "who am I when the world changes?".
  const PERSISTENT = [
    { role: 'community_builder', occ: 'care worker', changed: false, home: 'apartments', work: 'council', traits: { altruism: .9, sociability: .8, caution: .4, ambition: .3 }, note: 'servant-leader; runs mutual aid' },
    { role: 'crime_boss', occ: 'unemployed', changed: false, home: 'warehouse', work: 'warehouse', traits: { altruism: .3, sociability: .5, caution: .6, ambition: .9 }, note: 'provides through fear; taxes the market' },
    { role: 'pastor', occ: 'retired', changed: false, home: 'church', work: 'church', traits: { altruism: .85, sociability: .7, caution: .5, ambition: .2 }, note: 'meaning-maker; quiet doubt' },
    { role: 'hidden_changed', occ: 'care worker', changed: true, ability: 'sense_contamination', hidden: true, home: 'apartments', work: 'garden', traits: { altruism: .8, sociability: .3, caution: .95, ambition: .2 }, note: 'senses bad water; hides her power' },
    { role: 'ber_agent', occ: 'medic', changed: false, home: 'checkpoint', work: 'checkpoint', traits: { altruism: .5, sociability: .4, caution: .8, ambition: .5 }, note: 'conscience vs. orders' },
    { role: 'teacher', occ: 'teacher', changed: false, home: 'apartments', work: 'council', traits: { altruism: .8, sociability: .6, caution: .5, ambition: .4 }, note: 'prepares the kids' },
    { role: 'smuggler', occ: 'driver', changed: false, home: 'safehouse', work: 'warehouse', traits: { altruism: .4, sociability: .6, caution: .7, ambition: .7 }, note: 'moves scarce goods' },
    { role: 'shopkeeper', occ: 'shopkeeper', changed: false, home: 'apartments', work: 'market', traits: { altruism: .5, sociability: .6, caution: .6, ambition: .5 }, note: 'holds the food stock' },
  ];

  function weightedEthn(rng) {
    let r = rng.next();
    for (const [e, w] of ETHN) { if ((r -= w) <= 0) return e; }
    return 'Latino';
  }
  function makeName(rng, eth) {
    const n = NAMES[eth] || NAMES.Latino;
    const sex = rng.chance(0.5) ? 'f' : 'm';
    return rng.pick(n[sex]) + ' ' + rng.pick(n.l);
  }

  /* ------------------------------------------------------------- factory ---*/
  let _uid = 1;
  const uid = (p) => (p || 'x') + (_uid++);

  function makePerson(rng, opts) {
    opts = opts || {};
    const eth = opts.ethnicity || weightedEthn(rng);
    const changed = ('changed' in opts) ? opts.changed : rng.chance(CFG.CHANGED_BASE_RATE);
    return {
      id: uid('p'),
      name: opts.name || makeName(rng, eth),
      ethnicity: eth,
      age: 18 + rng.int(60),              // aging disabled: fixed trait
      occupation: opts.occ || rng.pick(OCC),
      role: opts.role || 'resident',
      persistent: !!opts.persistent,
      homeId: opts.home || 'apartments',
      workId: opts.work || rng.pick(['market', 'garden', 'council', 'warehouse', 'church']),
      locId: opts.home || 'apartments',
      needs: { food: 60 + rng.int(30), water: 60 + rng.int(30), rest: 70 + rng.int(20), safety: 60 + rng.int(30) },
      personality: opts.traits || { altruism: rng.next(), sociability: rng.next(), caution: rng.next(), ambition: rng.next() },
      morality: 40 + rng.int(50),         // higher = less willing to harm/steal
      resources: { food: rng.int(5), water: rng.int(5), goods: rng.int(3) },
      relationships: {},                   // id -> {trust,affinity,debt}
      memory: [],                          // L10
      knows: {},                           // factId -> confidence 0..100 (L8)
      changed: changed,
      ability: changed ? (opts.ability || rng.pick(['sense_contamination', 'endurance', 'fast_healing', 'strength', 'acuity'])) : null,
      hidden: changed ? (('hidden' in opts) ? opts.hidden : true) : false,  // Part IV: hiding is default
      fear: 20 + rng.int(30), stress: 20 + rng.int(30), hope: 45 + rng.int(30),
      trustTales: 0,                       // per-NPC trust toward the player
      goal: 'live',                        // current short-term goal
      note: opts.note || '',
    };
  }

  function createWorld(seed) {
    seed = (seed == null) ? (Date.now() & 0xffffffff) : (seed >>> 0);
    _uid = 1;
    const rng = makeRng(seed);
    const locations = {};
    for (const d of LOC_DEFS) {
      locations[d.id] = Object.assign({ present: [] }, d);
    }
    // Location resource state
    locations.market.stock = 40;          // food units for sale/barter
    locations.garden.produce = 0;         // accrues, harvested daily
    locations.warehouse.stock = 120;      // inflow reserve
    locations.church.sanctuary = true;
    locations.safehouse.hidden = true;

    const people = [];
    // 40 persistent NPCs (8 archetypes x ~5 each), rest background.
    let made = 0;
    for (let i = 0; i < CFG.POP_PERSISTENT; i++) {
      const arch = PERSISTENT[i % PERSISTENT.length];
      people.push(makePerson(rng, Object.assign({ persistent: true }, arch)));
      made++;
    }
    for (; made < CFG.POP_TOTAL; made++) people.push(makePerson(rng, { persistent: false }));

    const byId = {};
    people.forEach((p) => { byId[p.id] = p; locations[p.homeId].present; });

    // Relationships (L3): sparse, O(N*k). Households + a few neighbors + work ties.
    for (const p of people) {
      const links = 2 + rng.int(4);
      for (let i = 0; i < links; i++) {
        const q = rng.pick(people);
        if (q.id === p.id) continue;
        const bond = { trust: 20 + rng.int(50), affinity: -10 + rng.int(70), debt: 0 };
        p.relationships[q.id] = bond;
      }
    }

    const world = {
      seed, rng, tick: 0, day: 1, hour: 6,
      locations, people, byId,
      facts: [],                 // L8 knowledge/rumors
      conflicts: [],             // Conflict Bible
      quests: [],                // Quest Bible (slices of conflicts)
      storyLog: [],              // emergent narrative record
      district: { food: 60, safeWater: 55, morale: 55, cohesion: 55, crime: 45, berThreat: 15, berPosture: 0 },
      player: {
        locId: 'apartments', energy: 100, strain: 0, form: null, imprints: [],
        repDistrict: 0, berThreatTales: 0, photos: [], knows: {}, actions: 0,
        timesSeenShifting: 0,
        roster: [],            // surfaced imprints (<= CFG.ROSTER_MAX), readily wearable
        injured: false,        // combat aftermath; healed by rest at home
        items: [
          { id: 'pipe', kind: 'weapon', name: 'length of pipe', bonus: 3, reusable: true },
          { id: 'adrenaline', kind: 'buff', name: 'adrenaline shot', uses: 1 },
          { id: 'bleach', kind: 'debuff', name: 'handful of bleach powder', uses: 1 },
        ],
      },
      _lastConflictScan: 0,
    };
    // Seed one true baseline fact so knowledge has somewhere to start.
    addFact(world, { payload: 'the market stock is running low', truth: true, virality: 40 }, sampleKnowers(world, 0.05));
    log(world, 'You step onto the block. Six streets, 250 lives already in motion.', 'meta');
    return world;
  }

  /* ------------------------------------------------------ knowledge (L8) ---*/
  function addFact(world, f, knownByIds) {
    const fact = { id: uid('f'), payload: f.payload, truth: !!f.truth, confidence: f.confidence || 45, virality: f.virality || 40, tick: world.tick };
    world.facts.push(fact);
    (knownByIds || []).forEach((id) => { const p = world.byId[id]; if (p) p.knows[fact.id] = fact.confidence; });
    return fact;
  }
  function sampleKnowers(world, frac) {
    return world.people.filter(() => world.rng.chance(frac)).map((p) => p.id);
  }

  /* -------------------------------------------------------------- logging --*/
  function log(world, text, tag) {
    world.storyLog.unshift({ tick: world.tick, day: world.day, hour: world.hour, text, tag: tag || '' });
    if (world.storyLog.length > 400) world.storyLog.pop();
  }
  function pmem(p, world, text) { p.memory.unshift({ tick: world.tick, text }); if (p.memory.length > 24) p.memory.pop(); }

  /* =====================================================================
   * SYSTEMS — each runs once per hourly tick (except worldUpdate @ 12h)
   * =================================================================== */
  const Sys = {
    clock(w) {
      w.tick++; w.hour++;
      if (w.hour >= 24) { w.hour = 0; w.day++; }
    },

    schedules(w) {
      // Move each person toward a scheduled location for this hour.
      // Interruptions: BER lockdown (posture>=2) makes the fearful shelter home.
      for (const l of Object.values(w.locations)) l.present = [];
      const lockdown = w.district.berPosture >= 2;
      for (const p of w.people) {
        let target;
        const h = w.hour;
        if (h < 6 || h >= 22) target = p.homeId;                 // sleep
        else if (lockdown && p.fear > 55) target = p.homeId;      // shelter
        else if (p.needs.food < 35) target = w.rng.chance(0.5) ? 'market' : 'garden'; // seek food
        else if (h >= 8 && h < 18) target = p.workId;             // work
        else target = w.rng.chance(0.4) ? 'church' : (w.rng.chance(0.5) ? 'council' : p.homeId); // social
        p.locId = target;
        w.locations[target].present.push(p.id);
      }
    },

    needs(w) {
      for (const p of w.people) {
        for (const k in CFG.DECAY) p.needs[k] = clamp(p.needs[k] - CFG.DECAY[k]);
        // consume own resources to top up
        if (p.needs.food < 55 && p.resources.food > 0) { p.resources.food--; p.needs.food = clamp(p.needs.food + 25); }
        if (p.needs.water < 55 && p.resources.water > 0) { p.resources.water--; p.needs.water = clamp(p.needs.water + 25); }
        if (p.locId === p.homeId) p.needs.rest = clamp(p.needs.rest + 4);
        // safety need reflects local threat
        p.needs.safety = clamp(100 - w.district.crime * 0.5 - w.district.berThreat * 0.3 - p.fear * 0.2);
        // stress/hope drift from need satisfaction
        const wellbeing = (p.needs.food + p.needs.water + p.needs.safety) / 3;
        p.stress = clamp(p.stress + (wellbeing < 40 ? 2 : -1));
        p.hope = clamp(p.hope + (wellbeing > 65 ? 1 : -1) + (w.district.cohesion > 60 ? 0.3 : -0.3));
      }
    },

    economy(w) {
      const L = w.locations;
      // Garden produces food (daily harvest handled in worldUpdate; hourly trickle here)
      L.garden.produce += 0.4;
      // Market restocks slowly from warehouse inflow if not blockaded
      if (L.warehouse.stock > 0 && L.market.stock < 40 && w.tick % 3 === 0) { L.warehouse.stock--; L.market.stock += 1; }
      // People at market/garden acquire food if available
      for (const id of L.market.present) {
        const p = w.byId[id];
        if (p.needs.food < 60 && L.market.stock > 0) { L.market.stock--; p.resources.food++; p.needs.food = clamp(p.needs.food + 15); }
      }
      for (const id of L.garden.present) {
        const p = w.byId[id];
        if (p.needs.food < 60 && L.garden.produce >= 1) { L.garden.produce--; p.resources.food++; p.needs.food = clamp(p.needs.food + 15); }
      }
      // District food index tracks market+garden supply
      w.district.food = clamp((L.market.stock + L.garden.produce + L.warehouse.stock * 0.2));
    },

    // ---- The universal 7-question Decision Model (Sim Bible) ----
    decisions(w) {
      for (const p of w.people) {
        // 1 who am I / 5 what do I want -> set goal from dominant need
        const n = p.needs;
        let goal = 'live';
        if (n.food < 30) goal = 'find_food';
        else if (n.safety < 30) goal = 'seek_safety';
        else if (p.stress > 70) goal = 'find_comfort';
        else if (p.personality.altruism > 0.7 && w.district.morale < 45) goal = 'help_others';
        else if (p.personality.ambition > 0.75 && w.district.crime > 55) goal = 'seize_opportunity';
        p.goal = goal;

        // 6 what will I risk (fear/morality gate) -> 7 act
        const desperate = n.food < 22 || n.safety < 22;
        if (goal === 'find_food') {
          if (desperate && p.morality < 45 && w.rng.chance(0.35)) {
            // need-dominance -> theft: raises crime, damages a bond, memory
            w.district.crime = clamp(w.district.crime + 0.6);
            p.needs.food = clamp(p.needs.food + 20);
            pmem(p, w, 'took food I could not pay for');
            p.morality = clamp(p.morality - 1);
            if (p.persistent && w.rng.chance(0.15)) log(w, `${p.name} was seen taking food from the market — hunger over honesty.`, 'crime');
          }
        } else if (goal === 'help_others') {
          // altruistic residents at cohesion hubs provide mutual aid (Part V) — a
          // counter-force to scarcity so the no-player world can stabilize, not only collapse.
          const l = w.locations[p.locId];
          if (l && (l.kind === 'garden' || l.kind === 'council' || l.kind === 'faith')) {
            w.district.cohesion = clamp(w.district.cohesion + 0.05);
            w.district.morale = clamp(w.district.morale + 0.04);
            if (l.kind === 'garden') l.produce += 0.25;
            if (w.rng.chance(0.02) && p.persistent) pmem(p, w, 'spent the day helping neighbors');
          }
        }
      }
    },

    relationships(w) {
      // Co-located people with positive affinity build trust; stress erodes it.
      for (const l of Object.values(w.locations)) {
        const ids = l.present;
        if (ids.length < 2) continue;
        // sample a few pairs (cheap)
        for (let i = 0; i < Math.min(ids.length, 6); i++) {
          const a = w.byId[w.rng.pick(ids)], b = w.byId[w.rng.pick(ids)];
          if (a.id === b.id) continue;
          const bond = a.relationships[b.id] || (a.relationships[b.id] = { trust: 15, affinity: 0, debt: 0 });
          if (bond.affinity >= 0 && a.personality.sociability > 0.4) {
            bond.trust = clamp(bond.trust + 0.5, -100, 100);
            bond.affinity = clamp(bond.affinity + 0.4, -100, 100);
          }
          if (l.kind === 'faith' || l.kind === 'garden') bond.trust = clamp(bond.trust + 0.4, -100, 100); // cohesion hubs
        }
      }
    },

    knowledge(w) {
      // Rumors spread among co-located; distort; confidence drifts (L8/Narrative).
      for (const l of Object.values(w.locations)) {
        const ids = l.present; if (ids.length < 2) continue;
        for (const f of w.facts) {
          const carriers = ids.filter((id) => w.byId[id].knows[f.id] != null);
          if (!carriers.length) continue;
          const spreadN = Math.min(ids.length, 1 + Math.floor(f.virality / 25));
          for (let i = 0; i < spreadN; i++) {
            const tgt = w.byId[w.rng.pick(ids)];
            if (tgt.knows[f.id] == null && w.rng.chance(0.5)) {
              // confidence degrades with distance from source; false+viral spreads well
              tgt.knows[f.id] = clamp((f.truth ? 55 : 60) - w.rng.int(20));
            }
          }
        }
      }
      // decay old facts' virality
      if (w.tick % 6 === 0) w.facts.forEach((f) => { f.virality = clamp(f.virality - 4); });
    },

    // ---- Conflict Bible: detect incompatible goals -> spawn conflicts ----
    conflicts(w) {
      if (w.tick - w._lastConflictScan < 2) return;
      w._lastConflictScan = w.tick;
      const d = w.district;
      const has = (key) => w.conflicts.some((c) => c.active && c.key === key);

      // (1) Resource conflict: food scarcity + a taxing crime boss
      if (d.food < 35 && !has('food_market')) {
        const boss = w.people.find((p) => p.role === 'crime_boss');
        spawnConflict(w, {
          key: 'food_market', cause: 'scarcity+power',
          parties: ['the hungry block', boss ? boss.name : 'a crew'],
          contested: 'the corner market food supply', scale: 'neighborhood',
          desc: 'Food is short and a crew is taxing what reaches the market.',
        });
      }
      // (2) Water conflict: unsafe water + a hidden Changed who could help
      if (d.safeWater < 40 && !has('bad_water')) {
        const nena = w.people.find((p) => p.ability === 'sense_contamination');
        spawnConflict(w, {
          key: 'bad_water', cause: 'survival+fear',
          parties: ['residents', 'the water source'],
          contested: 'which water is safe to drink', scale: 'street',
          desc: 'People are getting sick from the water; only a hidden few can tell which is safe.',
          secret: nena ? nena.id : null,
        });
      }
      // (3) Political/BER conflict: escalation vs. the community
      if (d.berThreat > 55 && d.berPosture >= 2 && !has('ber_pressure')) {
        spawnConflict(w, {
          key: 'ber_pressure', cause: 'fear+politics',
          parties: ['BER', 'the neighborhood council'],
          contested: 'who controls the block', scale: 'neighborhood',
          desc: 'BER has raised a checkpoint and the council is losing legitimacy.',
        });
      }
      // (4) Morale collapse conflict
      if (d.morale < 30 && !has('despair')) {
        spawnConflict(w, {
          key: 'despair', cause: 'survival+hope',
          parties: ['the block', 'itself'],
          contested: 'whether the community holds together',
          scale: 'neighborhood', desc: 'Morale is collapsing; the block could fracture.',
        });
      }

      // Escalation / de-escalation of active conflicts (driven by district state)
      for (const c of w.conflicts) {
        if (!c.active) continue;
        const pressure = (d.crime - 50) + (55 - d.morale);
        if (pressure > 20) c.escalation = Math.min(4, c.escalation + (w.rng.chance(0.3) ? 1 : 0));
        else if (pressure < -10) c.escalation = Math.max(0, c.escalation - (w.rng.chance(0.3) ? 1 : 0));
        // natural resolution when the root cause eases
        const eased = (c.key === 'food_market' && d.food > 55) || (c.key === 'bad_water' && d.safeWater > 60)
          || (c.key === 'despair' && d.morale > 50) || (c.key === 'ber_pressure' && d.berThreat < 30);
        if (eased) resolveConflict(w, c, 'the pressure eased on its own');
      }
    },

    // ---- Quest Bible: quests are SLICES of conflicts (no markers) ----
    quests(w) {
      for (const c of w.conflicts) {
        if (!c.active) continue;
        if (w.quests.some((q) => q.conflictId === c.id)) continue;
        // derive quest slices from the conflict
        const archetype = ({
          food_market: 'Resource / Negotiation', bad_water: 'Investigation / Rescue',
          ber_pressure: 'Diplomacy / Defense', despair: 'Community / Leadership',
          shapeshifter: 'Identity / Exposure',
        })[c.key] || 'Investigation';
        // a situation about the player (the block fearing a shapeshifter) is felt at once
        const selfEvident = c.key === 'shapeshifter';
        w.quests.push({
          id: uid('q'), conflictId: c.id, key: c.key, archetype,
          title: c.desc, discovered: selfEvident, state: 'open', bornTick: w.tick,
        });
      }
    },

    community(w) {
      const d = w.district;
      // roll up morale/cohesion/crime from people (bottom-up)
      let hope = 0, stress = 0, coh = 0, n = 0;
      for (const p of w.people) { hope += p.hope; stress += p.stress; n++; }
      hope /= n; stress /= n;
      // cohesion from average relationship trust at hubs (cheap proxy)
      d.morale = clamp(0.7 * d.morale + 0.3 * (hope - stress * 0.4 + 40));
      d.cohesion = clamp(0.9 * d.cohesion + 0.1 * (d.morale) + (w.locations.church.present.length + w.locations.garden.present.length) * 0.05);
      d.crime = clamp(0.85 * d.crime + 0.15 * (60 - d.food * 0.5 + (100 - d.morale) * 0.3 - w.player.repDistrict * 0.05));
      // BER threat from disorder + visible player power use (Part IX B / Ch5)
      const disorder = Math.max(0, (d.crime - 50) + (55 - d.morale));
      d.berThreat = clamp(d.berThreat + disorder * 0.05 + (w.player.berThreatTales > 50 ? 0.5 : 0) - 0.4);
      const np = d.berThreat > 78 ? 3 : d.berThreat > 52 ? 2 : d.berThreat > 28 ? 1 : 0;
      if (np > d.berPosture) { d.berPosture = np; log(w, `BER escalates posture -> ${['Observe', 'Monitor', 'Suppress', 'Contain'][np]} (disorder crossed a threshold).`, 'ber'); }
      else if (np < d.berPosture && w.rng.chance(0.1)) d.berPosture = Math.max(0, d.berPosture - 1);
      // safe water erodes with crime/neglect, recovers slowly (Part I stratification)
      d.safeWater = clamp(d.safeWater + (d.cohesion > 60 ? 0.3 : -0.5));
      // player identity strain recovers when energy high (Part I)
      if (w.player.energy > 60) w.player.strain = clamp(w.player.strain - 0.5);
      w.player.energy = clamp(w.player.energy + 1.5);            // rest
      w.player.berThreatTales = clamp(w.player.berThreatTales - 0.4);
    },

    worldUpdate(w) {
      // 12-hour heavier settle (Decision Sheet)
      const L = w.locations;
      // daily-ish garden harvest into produce already trickled; warehouse inflow event
      if (w.rng.chance(0.5) && L.warehouse.stock < 60) { L.warehouse.stock += 20; log(w, 'A supply run reached the warehouse.', 'econ'); }
      else if (w.rng.chance(0.4)) { L.warehouse.stock = Math.max(0, L.warehouse.stock - 15); log(w, 'A convoy failed at the checkpoint — reserves dropped.', 'econ'); }
      // seed a rumor from current tensions (Narrative L8)
      if (w.district.food < 40 && w.rng.chance(0.6)) addFact(w, { payload: 'the next block is hoarding food', truth: false, virality: 55 }, sampleKnowers(w, 0.06));
      if (w.district.berThreat > 50 && w.rng.chance(0.5)) addFact(w, { payload: 'BER is disappearing people nearby', truth: false, virality: 60 }, sampleKnowers(w, 0.05));
      // prune stale resolved quests
      w.quests = w.quests.filter((q) => q.state === 'open' || w.tick - q.bornTick < 240);
    },
  };

  function spawnConflict(w, c) {
    const conflict = Object.assign({ id: uid('c'), active: true, escalation: 0, bornTick: w.tick, resolutionPaths: ['negotiate', 'restore resource', 'mediate', 'expose', 'leadership'] }, c);
    w.conflicts.push(conflict);
    log(w, `A conflict emerges: ${c.desc} [${c.cause}]`, 'conflict');
    return conflict;
  }
  function resolveConflict(w, c, how) {
    c.active = false; c.resolvedTick = w.tick; c.resolution = how;
    const q = w.quests.find((x) => x.conflictId === c.id && x.state === 'open');
    if (q) q.state = 'resolved';
    log(w, `Conflict resolved (${c.contested}): ${how}. The block remembers.`, 'resolve');
    // memory-on-resolve: a permanent-ish shift
    w.district.morale = clamp(w.district.morale + 3);
  }

  /* ------------------------------------------------------------ the tick --*/
  function tick(w) {
    Sys.clock(w);
    Sys.schedules(w);
    Sys.needs(w);
    Sys.economy(w);
    Sys.decisions(w);
    Sys.relationships(w);
    Sys.knowledge(w);
    if (w.tick % CFG.WORLD_UPDATE_HOURS === 0) Sys.worldUpdate(w);
    Sys.conflicts(w);
    Sys.quests(w);
    Sys.community(w);
    return w;
  }
  function step(w, hours) { for (let i = 0; i < (hours || 1); i++) tick(w); return w; }

  /* =====================================================================
   * PLAYER (TALES) ACTIONS — Tales is just an actor with extra verbs.
   *   Perception-first; combat is intentionally NOT a verb in the slice.
   * =================================================================== */
  function here(w) { return w.locations[w.player.locId]; }
  function coLocated(w) { return here(w).present.map((id) => w.byId[id]); }

  /* =====================================================================
   * RPG LAYER — combat, stats, the arsenal of selves (Identity Bible)
   *   Your power in a fight IS whose self you wear. One form, one power.
   * =================================================================== */
  const TALES_BASE = { str: 5, spd: 5, wit: 5, res: 6 };   // former security guard: steady, unspecial
  function clamp10(x) { return Math.max(1, Math.min(10, Math.round(x))); }
  function statsOf(p) {
    if (!p) return Object.assign({}, TALES_BASE);
    const t = p.personality || {}, age = p.age || 35;
    const str = 3 + (t.ambition || 0.4) * 3 + (p.role === 'crime_boss' ? 3 : 0) + (p.ability === 'strength' ? 4 : 0);
    const spd = 4 + (1 - (age - 18) / 78) * 4 + (p.ability === 'acuity' ? 2 : 0) + (p.ability === 'fast_healing' ? 1 : 0);
    const wit = 3 + (t.caution || 0.5) * 4 + (p.ability === 'acuity' ? 3 : 0);
    const res = 3 + (t.altruism || 0.4) * 2 + (p.hope || 40) / 25 + (p.ability === 'endurance' ? 4 : 0);
    return { str: clamp10(str), spd: clamp10(spd), wit: clamp10(wit), res: clamp10(res) };
  }
  function hpOf(s) { return 16 + s.res * 3 + s.str; }
  function playerStats(w) {
    const base = w.player.form ? statsOf(w.byId[w.player.form]) : Object.assign({}, TALES_BASE);
    if (w.player.injured) { base.str = clamp10(base.str - 2); base.spd = clamp10(base.spd - 2); }
    return base;
  }
  // a person's "inner life" line for the codex (humanity, not a stat block)
  function innerThought(p) {
    const m = {
      community_builder: 'Thinks about who didn’t eat today, and how to fix it without anyone noticing.',
      crime_boss: 'Believes softness gets people killed; provides through fear because it works.',
      pastor: 'Prays over a doubt he can’t say aloud: that no one is coming to save them.',
      hidden_changed: 'Carries a secret like a stone — one wrong word and BER takes everything.',
      ber_agent: 'Follows orders she’s stopped believing in, and hates the quiet afterward.',
      teacher: 'Is trying to prepare children for a world she can’t picture.',
      smuggler: 'Keeps a running tally of who owes whom; sentiment is a luxury.',
      shopkeeper: 'Rations the shelves and his own hope in equal measure.',
    };
    return m[p.role] || (p.changed ? 'Hides a change no one can know about; wants only to be ordinary again.' : 'Just wants to get through the day and keep their people safe.');
  }
  function talentsOf(p) {
    const ts = [];
    if (p.role === 'teacher' || (p.personality && p.personality.sociability > 0.6)) ts.push('persuasion');
    if (p.role === 'ber_agent' || p.occupation === 'medic') ts.push('first aid');
    if (p.role === 'smuggler' || p.role === 'crime_boss') ts.push('streetwise');
    if (p.role === 'community_builder') ts.push('organizing');
    if (p.ability) ts.push('Changed: ' + p.ability.replace(/_/g, ' '));
    return ts.length ? ts : ['ordinary'];
  }
  // --- the arsenal: 6 surfaced selves; the rest sink and need home to retrieve ---
  function surfaceImprint(w, id) {
    const r = w.player.roster;
    const i = r.indexOf(id); if (i >= 0) r.splice(i, 1);
    r.unshift(id);
    let sank = null;
    while (r.length > CFG.ROSTER_MAX) sank = r.pop();
    return sank;
  }
  function deepImprints(w) { return w.player.imprints.filter((id) => w.player.roster.indexOf(id) < 0); }
  // shared consequences of on-street violence (Design Pillars: force always costs)
  function applyViolence(w, o) {
    const d = w.district, seers = witnessesHere(w, o.enemyId);
    d.crime = clamp(d.crime + 8); d.cohesion = clamp(d.cohesion - 6); d.morale = clamp(d.morale - 4); d.berThreat = clamp(d.berThreat + 8);
    w.player.repDistrict = clamp(w.player.repDistrict - (o.won ? 12 : 8), -100, 100);
    w.player.berThreatTales = clamp(w.player.berThreatTales + 12);
    for (const s of seers) { s.fear = clamp(s.fear + 18); s.trustTales = clamp(s.trustTales - 12, -100, 100); pmem(s, w, 'saw violence on the block'); }
    addFact(w, { payload: 'there was violence on the block', truth: true, virality: 60, confidence: 55 }, seers.map((s) => s.id));
    log(w, `Violence on the block${o.enemyName ? ' — ' + o.enemyName + ' involved' : ''}. People saw.`, 'crime');
  }

  const Player = {
    move(w, locId) {
      if (!w.locations[locId]) return { ok: false, msg: 'no such place' };
      w.player.locId = locId; w.player.actions++;
      step(w, 1);
      return { ok: true, msg: `You walk to the ${w.locations[locId].name}.` };
    },
    observe(w) {
      // free perception: read the block + a few decision models (no tick cost)
      const ppl = coLocated(w).slice(0, 8).map((p) => `${p.name} (${p.occupation}) — ${describeGoal(p)}${p.persistent ? '' : ''}`);
      return { ok: true, free: true, people: ppl, district: Object.assign({}, w.district) };
    },
    talk(w, id, topic) {
      const p = w.byId[id]; if (!p || p.locId !== w.player.locId) return { ok: false, msg: 'they are not here' };
      topic = topic || 'them';
      // --- recognition while disguised (Identity Bible: wearing the wrong face) ---
      let passNote = '';
      if (w.player.form) {
        const know = knowsPerson(p, w.player.form, w); const form = w.byId[w.player.form];
        if (know === 3) {
          // talking to someone while wearing THEIR face
          p.fear = clamp(p.fear + 45); p.stress = clamp(p.stress + 25); p.trustTales = clamp(p.trustTales - 45, -100, 100);
          w.player.berThreatTales = clamp(w.player.berThreatTales + 15); w.district.morale = clamp(w.district.morale - 3);
          addFact(w, { payload: `${p.name} met someone wearing their own face`, truth: true, virality: 78, confidence: 72 }, [p.id].concat(sampleKnowers(w, 0.03)));
          log(w, `${p.name} came face to face with their own stolen face.`, 'fear');
          ensureShapeshifterConflict(w);
          w.player.actions++; step(w, 1);
          return { ok: true, recognized: 'self', msg: `You speak to ${p.name} while wearing ${p.name}'s face. They go white — they are staring at themselves. Whatever trust there was is gone, and they will tell everyone.` };
        }
        if (know === 2) {
          const detect = w.rng.chance(0.28 + (p.personality.caution || 0.5) * 0.4 + w.player.strain / 170);
          if (detect) {
            p.fear = clamp(p.fear + 20); p.trustTales = clamp(p.trustTales - 20, -100, 100);
            w.player.berThreatTales = clamp(w.player.berThreatTales + 6);
            addFact(w, { payload: `${form.name} hasn’t been acting like themselves`, truth: true, virality: 55, confidence: 50 }, [p.id]);
            log(w, `${p.name} senses something wrong about “${form.name}.”`, 'fear');
            w.player.actions++; step(w, 1);
            return { ok: true, recognized: 'suspicious', msg: `You approach ${p.name} wearing ${form.name}'s face. They know ${form.name} well — and something in you is off. Their eyes narrow; you are not quite passing.` };
          }
          w.player.repDistrict = clamp(w.player.repDistrict + 1, -100, 100);
          passNote = ` They take you for ${form.name} and speak to you as such.`;
        } else if (form) {
          passNote = ` To ${p.name}, a stranger, you are just ${form.name}; the face holds.`;
        }
      }
      // --- conversation by topic ---
      let body = '', extra = '';
      if (topic === 'block') {
        p.trustTales = clamp(p.trustTales + 3, -100, 100);
        const fids = Object.keys(p.knows);
        if (fids.length) { const f = w.facts.find((x) => x.id === w.rng.pick(fids)); if (f) { w.player.knows[f.id] = p.knows[f.id]; body = ` They tell you what’s going around: “${f.payload}.”`; } }
        else body = ' They shrug — nothing they can put a finger on.';
      } else if (topic === 'situation') {
        discoverQuestsFor(w, p);
        const q = w.quests.find((x) => x.discovered && x.state === 'open');
        if (q) { q.progress = (q.progress || 0) + 1; body = ` You press about the trouble on the block; ${p.name} fills in a piece of it.`; }
        else body = ' You ask what’s wrong on the block, but they claim not to know.';
        p.trustTales = clamp(p.trustTales + 4, -100, 100);
      } else { // 'them'
        p.trustTales = clamp(p.trustTales + 8, -100, 100);
        w.player.repDistrict = clamp(w.player.repDistrict + 1, -100, 100);
        const fids = Object.keys(p.knows);
        if (fids.length) { const f = w.facts.find((x) => x.id === w.rng.pick(fids)); if (f) { w.player.knows[f.id] = p.knows[f.id]; body = ` They mention: “${f.payload}.”`; } }
        discoverQuestsFor(w, p);
        if (p.hidden && p.trustTales > 30) extra = ` ${p.name} lowers their voice — they trust you with something: they are Changed, and they’ve been hiding it.`;
      }
      step(w, 1);
      return { ok: true, msg: `You talk with ${p.name}.${passNote}${body}${extra}` };
    },
    // Fight now opens a turn-based battle (see Battle). Combat is a costly fallback.
    fight(w, id) {
      const p = id ? w.byId[id] : null;
      if (!p) return { ok: false, msg: 'There’s no one here to fight.' };
      if (p.locId !== w.player.locId) return { ok: false, msg: 'they are not here' };
      const b = Battle.start(w, id, { forced: false });
      return { ok: true, battle: true, msg: `You square up to ${p.name}. There’s no taking this back once it starts.`, log: b.log.slice() };
    },
    rest(w, hours) {
      if (here(w).kind !== 'home_private') return { ok: false, msg: 'You can only truly rest somewhere private — your own room.' };
      hours = hours || 4;
      w.player.energy = clamp(w.player.energy + hours * 8);
      w.player.strain = clamp(w.player.strain - hours * 6);
      let msg = `You rest in your room — you eat, wash, and let your own face settle back over you. ${hours} hours pass.`;
      if (w.player.injured) { w.player.injured = false; msg += ' Your injuries knit enough to move well again.'; }
      if (w.player.form) { w.player.form = null; msg += ' You let every borrowed self go and are simply yourself.'; }
      w.player.actions++; step(w, hours);
      return { ok: true, msg };
    },
    digDeeper(w, id) {
      if (here(w).kind !== 'home_private') return { ok: false, msg: 'You need the quiet of your room to reach that deep.' };
      if (!w.player.imprints.includes(id)) return { ok: false, msg: 'you carry no such self' };
      const sank = surfaceImprint(w, id);
      w.player.energy = clamp(w.player.energy - 8); w.player.strain = clamp(w.player.strain + 4);
      const p = w.byId[id];
      let msg = `You sit with the quiet and reach down for ${p ? p.name : 'a buried self'} — their face, their voice, the weight of them — until they rise close enough to wear again.`;
      if (sank) { const sp = w.byId[sank]; msg += ` As they surface, ${sp ? sp.name : 'another'} sinks back down.`; }
      w.player.actions++; step(w, 2);
      return { ok: true, msg };
    },
    investigate(w) {
      const l = here(w), peopleHere = coLocated(w); let learned = '';
      for (const q of peopleHere) discoverQuestsFor(w, q);
      discoverByPlace(w, w.player.locId);
      const holder = peopleHere.find((p) => Object.keys(p.knows).length);
      if (holder) { const fid = w.rng.pick(Object.keys(holder.knows)); const f = w.facts.find((x) => x.id === fid); if (f) { w.player.knows[f.id] = holder.knows[fid]; learned = ` You overhear: “${f.payload}.”`; } }
      const q = w.quests.find((x) => x.discovered && x.state === 'open' && questPlace(x.key) === w.player.locId);
      if (q) q.progress = (q.progress || 0) + 1;
      w.player.actions++; step(w, 1);
      return { ok: true, msg: `You dig into what’s happening around the ${l.name}, watching who talks to whom.${learned}` };
    },
    photograph(w, subjectId) {
      const p = subjectId ? w.byId[subjectId] : null;
      const photo = { tick: w.tick, subject: p ? p.name : here(w).name, loc: w.player.locId };
      w.player.photos.push(photo);
      w.player.repDistrict = clamp(w.player.repDistrict + 2, -100, 100);
      // inject verified info: cool the most viral false rumor known here
      const false_ = w.facts.filter((f) => !f.truth).sort((a, b) => b.virality - a.virality)[0];
      let msg = `You photograph ${photo.subject}.`;
      if (false_) { false_.virality = clamp(false_.virality - 25); msg += ` A true image cools the rumor: “${false_.payload}.”`; }
      if (w.player.locId === 'checkpoint' || w.district.berPosture >= 1) { w.player.berThreatTales = clamp(w.player.berThreatTales + 8); msg += ' BER noticed you shooting.'; }
      w.player.actions++; step(w, 1);
      return { ok: true, msg };
    },
    copy(w, id) {
      const p = w.byId[id]; if (!p || p.locId !== w.player.locId) return { ok: false, msg: 'skin contact needs them here' };
      if (w.player.energy < CFG.COPY_ENERGY) { w.player.strain = clamp(w.player.strain + CFG.OVERUSE_STRAIN); }
      w.player.energy = clamp(w.player.energy - CFG.COPY_ENERGY);
      w.player.strain = clamp(w.player.strain + CFG.IMPRINT_STRAIN);
      if (!w.player.imprints.includes(p.id)) w.player.imprints.push(p.id);
      const sank = surfaceImprint(w, p.id);   // bring this self to the surface; may sink an older one
      w.player.berThreatTales = clamp(w.player.berThreatTales + 8);   // visible power use
      let gain = 'their face, skills, and memories';
      if (p.ability === 'sense_contamination') gain = 'their hidden ability to sense bad water';
      // the person you touch always notices; so does anyone watching (Identity Bible)
      const wit = reactToShift(w, 'copy', p.name);
      p.fear = clamp(p.fear + 35); p.trustTales = clamp(p.trustTales - 40, -100, 100);
      pmem(p, w, 'felt Tales take a copy of them');
      log(w, `You copy ${p.name}. A new Imprint takes root (${gain}).${wit.seen ? ' It was seen.' : ' No one else was near.'}`, 'mimicry');
      w.player.actions++; step(w, 1);
      let msg = `Skin contact — you copy ${p.name}. You gain ${gain}. Identity strain rises.`;
      msg += wit.seen ? ` ${wit.text} ${p.name} recoils from your hand.` : ' No one else is near; the theft goes unseen.';
      if (sank) { const sp = w.byId[sank]; msg += ` Your mind is crowded now — ${sp ? sp.name : 'an earlier self'} slips beneath the surface (retrieve them at home).`; }
      return { ok: true, msg, witnessed: wit.seen, sank };
    },
    wear(w, id) {
      if (!w.player.imprints.includes(id)) return { ok: false, msg: 'you have no imprint of them' };
      if (w.player.roster.indexOf(id) < 0) { const dp = w.byId[id]; return { ok: false, msg: `${dp ? dp.name : 'That self'} has sunk too deep to wear right now — go to your room and dig deeper for them.` }; }
      const already = w.player.form; w.player.form = id; const p = w.byId[id];
      surfaceImprint(w, id);
      w.player.strain = clamp(w.player.strain + 3);
      const wit = reactToShift(w, 'wear', p.name);   // turning into someone in public is alarming
      let msg = `You take on ${p.name}'s form; among strangers you now pass as them, and wear their standing.`;
      if (wit.seen) msg += ` But ${wit.text} They watched you become ${p.name}.`;
      else msg += ' No one is around to see the change.';
      if (already) w.player.actions++;
      return { ok: true, msg, witnessed: wit.seen };
    },
    revert(w) {
      const had = w.player.form; w.player.form = null;
      if (!had) return { ok: true, msg: 'You are already yourself.' };
      const wit = reactToShift(w, 'revert', 'themselves');
      let msg = 'You let the borrowed face go and return to your own — the hardest form to wear.';
      if (wit.seen) msg += ` ${wit.text} One moment you were someone; the next, someone else.`;
      return { ok: true, msg, witnessed: wit.seen };
    },
    help(w) {
      // contribute at the current location: garden/market/council/church boost the block
      const l = here(w); let msg = 'Not much to do here.';
      if (l.kind === 'garden') { l.produce += 4; w.district.cohesion = clamp(w.district.cohesion + 2); w.district.morale = clamp(w.district.morale + 2); msg = 'You work the garden. Food and cohesion rise.'; }
      else if (l.kind === 'market') { l.stock += 3; w.district.food = clamp(w.district.food + 2); msg = 'You help stock the market.'; }
      else if (l.kind === 'council' || l.kind === 'faith') { w.district.cohesion = clamp(w.district.cohesion + 3); w.district.morale = clamp(w.district.morale + 3); msg = 'You support the community. Cohesion and morale rise.'; }
      else if (l.kind === 'safehouse') { w.district.safeWater = clamp(w.district.safeWater + 3); msg = 'You help distribute clean water from the safe house.'; }
      w.player.repDistrict = clamp(w.player.repDistrict + 5, -100, 100);
      w.player.energy = clamp(w.player.energy - 6);
      w.player.actions++; step(w, 1);
      return { ok: true, msg };
    },
    useAbility(w) {
      // if carrying the water-sense imprint, use it to protect the block (L9)
      const hasSense = w.player.imprints.some((id) => w.byId[id] && w.byId[id].ability === 'sense_contamination');
      if (!hasSense) return { ok: false, msg: 'you have no ability that helps here' };
      w.player.energy = clamp(w.player.energy - 10); w.player.strain = clamp(w.player.strain + 3);
      w.district.safeWater = clamp(w.district.safeWater + 8); w.district.morale = clamp(w.district.morale + 3);
      w.player.actions++; step(w, 1);
      return { ok: true, msg: 'You sense the fouled water and steer people off it. Illnesses averted; no one knows why.' };
    },
    wait(w, hours) { w.player.actions++; step(w, hours || 1); return { ok: true, msg: `You watch and wait. ${hours || 1}h pass. The block does not wait for you.` }; },
  };

  /* =====================================================================
   * BATTLE — turn-based, stat-driven; your power is the self you wear.
   *   Attack (str/spd) · Special (this form's Changed power) · Item · Change form · Flee
   * =================================================================== */
  function describeBuild(s) { return s.str >= 7 ? 'powerful' : s.spd >= 7 ? 'quick' : s.res >= 7 ? 'hard to put down' : 'ordinary'; }
  const Battle = {
    start(w, enemyId, opts) {
      opts = opts || {};
      const e = w.byId[enemyId];
      const ys = playerStats(w);
      const you = { name: w.player.form ? (w.byId[w.player.form].name + ' (you)') : 'you', stats: ys, maxHp: hpOf(ys), hp: hpOf(ys), atkBonus: 0, defBonus: 0 };
      const es = e ? statsOf(e) : { str: 5, spd: 5, wit: 4, res: 5 };
      const enemy = { id: enemyId, name: e ? e.name : 'a stranger', role: e ? e.role : null, changed: e ? !!e.changed : false, ability: e ? e.ability : null, stats: es, maxHp: hpOf(es), hp: hpOf(es), accPenalty: 0 };
      const b = { active: true, over: false, forced: !!opts.forced, round: 1, you, enemy, outcome: null, log: [`${enemy.name} turns to face you — they look ${describeBuild(es)}.`] };
      w.battle = b; return b;
    },
    _hit(att, def, base, label, log, rng) {
      const acc = 0.6 + (att.stats.spd - def.stats.spd) * 0.05 - (att.accPenalty || 0);
      if (!rng.chance(Math.max(0.15, Math.min(0.95, acc)))) { log.push(`${label} — but it misses.`); return 0; }
      let dmg = base + att.stats.str + (att.atkBonus || 0) - Math.round(def.stats.res / 2) - (def.defBonus || 0) + rng.int(3);
      dmg = Math.max(1, dmg); def.hp = Math.max(0, def.hp - dmg);
      log.push(`${label} for ${dmg}.`); return dmg;
    },
    _enemyTurn(w, b) {
      if (b.over) return; const rng = w.rng;
      if (b.enemy.changed && b.enemy.ability === 'strength' && rng.chance(0.35)) Battle._hit(b.enemy, b.you, 4, `${b.enemy.name} throws their whole weight in`, b.log, rng);
      else if (b.enemy.changed && b.enemy.ability === 'fast_healing' && b.enemy.hp < b.enemy.maxHp * 0.5 && rng.chance(0.4)) { const h = 6 + rng.int(4); b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + h); b.log.push(`${b.enemy.name}'s wounds close before your eyes (+${h}).`); }
      else Battle._hit(b.enemy, b.you, 2, `${b.enemy.name} strikes`, b.log, rng);
      b.enemy.accPenalty = 0; b.you.defBonus = 0;
      Battle._check(w, b);
    },
    _check(w, b) {
      if (b.you.hp <= 0) { b.over = true; b.active = false; b.outcome = 'lost'; Battle._resolve(w, b); }
      else if (b.enemy.hp <= 0) { b.over = true; b.active = false; b.outcome = 'won'; Battle._resolve(w, b); }
    },
    _resolve(w, b) {
      applyViolence(w, { won: b.outcome === 'won', enemyId: b.enemy.id, enemyName: b.enemy.name });
      const e = w.byId[b.enemy.id];
      if (b.outcome === 'won') {
        w.player.energy = clamp(w.player.energy - 18);
        if (e) { e.fear = clamp(e.fear + 45); e.stress = clamp(e.stress + 30); e.trustTales = clamp(e.trustTales - 45, -100, 100); pmem(e, w, 'was beaten by Tales'); }
        if (b.enemy.role === 'crime_boss') { w.district.food = clamp(w.district.food + 5); b.log.push('The crew eases off the market — bought with fear, not trust.'); }
        b.log.push(`${b.enemy.name} goes down. You stand over them, and the street has seen exactly what you are.`);
      } else if (b.outcome === 'lost') {
        w.player.injured = true; w.player.energy = clamp(w.player.energy - 30); if (w.player.form) w.player.form = null;
        b.log.push('It goes wrong. You take the worst of it and break away hurt — your room, and rest, are the only cure.');
      } else {
        w.player.energy = clamp(w.player.energy - 10);
        b.log.push('You break contact and lose yourself in the block.');
      }
      w.player.actions++; step(w, 1);
    },
    attack(w) { const b = w.battle; if (!b || b.over) return b; Battle._hit(b.you, b.enemy, 2, 'You strike', b.log, w.rng); Battle._check(w, b); if (!b.over) Battle._enemyTurn(w, b); b.round++; return b; },
    special(w) {
      const b = w.battle; if (!b || b.over) return b; const rng = w.rng;
      const ab = w.player.form ? (w.byId[w.player.form] || {}).ability : null;
      if (!ab) { b.log.push('This form has no special power — fight with your hands, or wear a self that can.'); return b; }
      if (ab === 'strength') Battle._hit(b.you, b.enemy, 6, 'You put a Changed strength behind it', b.log, rng);
      else if (ab === 'acuity') { let dmg = 5 + b.you.stats.str + (b.you.atkBonus || 0) - Math.round(b.enemy.stats.res / 2) + rng.int(4); dmg = Math.max(1, dmg); b.enemy.hp = Math.max(0, b.enemy.hp - dmg); b.log.push(`You read them and strike a nerve for ${dmg}.`); }
      else if (ab === 'endurance') { const h = 5 + rng.int(4); b.you.hp = Math.min(b.you.maxHp, b.you.hp + h); b.you.defBonus = 2; b.log.push(`You set a Changed endurance against the pain (+${h}; you’ll take less next).`); }
      else if (ab === 'fast_healing') { const h = 7 + rng.int(5); b.you.hp = Math.min(b.you.maxHp, b.you.hp + h); b.log.push(`Your wounds close as fast as they open (+${h}).`); }
      else if (ab === 'sense_contamination') { b.log.push('Sensing bad water does nothing in a fistfight — this self was never a fighter.'); return b; }
      else { b.log.push('This power finds no purchase in a fight.'); return b; }
      Battle._check(w, b); if (!b.over) Battle._enemyTurn(w, b); b.round++; return b;
    },
    item(w, itemId) {
      const b = w.battle; if (!b || b.over) return b;
      const inv = w.player.items, it = inv.find((x) => x.id === itemId); if (!it) return b;
      if (it.kind === 'weapon') { b.you.atkBonus = (b.you.atkBonus || 0) + it.bonus; b.log.push(`You ready the ${it.name} (+${it.bonus} to your blows).`); }
      else if (it.kind === 'buff') { b.you.stats = Object.assign({}, b.you.stats, { str: clamp10(b.you.stats.str + 2), spd: clamp10(b.you.stats.spd + 2) }); b.log.push(`The ${it.name} hits your blood — faster, harder to slow.`); }
      else if (it.kind === 'debuff') { b.enemy.accPenalty = 0.35; b.log.push(`You fling the ${it.name}; ${b.enemy.name} claws at their eyes, half-blind.`); }
      if (!it.reusable) { it.uses = (it.uses || 1) - 1; if (it.uses <= 0) inv.splice(inv.indexOf(it), 1); }
      Battle._enemyTurn(w, b); b.round++; return b;
    },
    changeForm(w, id) {
      const b = w.battle; if (!b || b.over) return b;
      if (w.player.roster.indexOf(id) < 0) { b.log.push('That self is too deep to reach mid-fight.'); return b; }
      w.player.form = id; surfaceImprint(w, id);
      const ns = playerStats(w), ratio = b.you.hp / b.you.maxHp;
      b.you.stats = ns; b.you.maxHp = hpOf(ns); b.you.hp = Math.max(1, Math.round(b.you.maxHp * ratio)); b.you.name = w.byId[id].name + ' (you)';
      b.log.push(`You shift into ${w.byId[id].name} between one breath and the next — your enemy, and the street, see it happen.`);
      reactToShift(w, 'wear', w.byId[id].name);
      Battle._enemyTurn(w, b); b.round++; return b;
    },
    flee(w) {
      const b = w.battle; if (!b || b.over) return b;
      if (b.forced) { b.log.push('There’s no running from this one.'); Battle._enemyTurn(w, b); return b; }
      const chance = 0.5 + (b.you.stats.spd - b.enemy.stats.spd) * 0.06;
      if (w.rng.chance(Math.max(0.2, Math.min(0.85, chance)))) { b.over = true; b.active = false; b.outcome = 'fled'; Battle._resolve(w, b); }
      else { b.log.push('You break for it — but they cut you off. No escape yet.'); Battle._enemyTurn(w, b); b.round++; }
      return b;
    },
    end(w) { w.battle = null; },
  };

  function describeGoal(p) {
    return ({ live: 'going about their day', find_food: 'looking for food', seek_safety: 'keeping their head down', find_comfort: 'stressed, seeking comfort', help_others: 'helping neighbors', seize_opportunity: 'looking for an angle' })[p.goal] || 'living';
  }
  function discoverQuestsFor(w, p) {
    // A quest becomes "discovered" only once the player has learned of the situation
    // through a relevant person/place — never a spawned marker (Quest Bible).
    for (const q of w.quests) {
      if (q.discovered || q.state !== 'open') continue;
      const c = w.conflicts.find((x) => x.id === q.conflictId);
      if (!c) continue;
      const relevant = (c.key === 'food_market' && (p.locId === 'market' || p.role === 'crime_boss' || p.role === 'shopkeeper'))
        || (c.key === 'bad_water' && (p.ability === 'sense_contamination' || p.locId === 'garden' || p.locId === 'safehouse'))
        || (c.key === 'ber_pressure' && (p.role === 'ber_agent' || p.role === 'community_builder'))
        || (c.key === 'despair');
      if (relevant) { q.discovered = true; log(w, `You piece together a situation: ${q.title} (${q.archetype}).`, 'quest'); }
    }
  }

  /* =====================================================================
   * IDENTITY CONSEQUENCES (Identity & Metamorphosis Bible)
   *   Being seen transform, and wearing the wrong face, must MATTER.
   * =================================================================== */
  function witnessesHere(w, exceptId) {
    return coLocated(w).filter((p) => p && p.id !== exceptId);
  }
  // Does 'target' know the person whose face is being worn? 3=it's them, 2=knows well, 1=acquainted, 0=stranger
  function knowsPerson(target, formId, w) {
    if (!formId) return 0;
    const form = w.byId[formId]; if (!form) return 0;
    if (target.id === formId) return 3;
    if (form.persistent) return 2;                 // everyone knows the notable locals
    const rel = target.relationships[formId];
    return rel && rel.trust > 20 ? 2 : (rel ? 1 : 0);
  }
  function ensureShapeshifterConflict(w) {
    if (w.conflicts.some((c) => c.active && c.key === 'shapeshifter')) return;
    spawnConflict(w, {
      key: 'shapeshifter', cause: 'fear+identity',
      parties: ['a frightened block', 'the thing wearing faces'],
      contested: 'whether anyone can be trusted to be who they say', scale: 'neighborhood',
      desc: 'People have seen someone wear another’s face; fear of impostors is spreading.',
    });
  }
  // Called when the player transforms (copy / wear / revert) with people present.
  function reactToShift(w, kind, formName) {
    const seers = witnessesHere(w);
    if (!seers.length) return { seen: false, agents: 0, text: '' };
    const d = w.district; let agents = 0;
    for (const p of seers) {
      const shock = 20 + Math.round((p.personality.caution || 0.5) * 22);
      p.fear = clamp(p.fear + shock); p.stress = clamp(p.stress + 14); p.hope = clamp(p.hope - 8);
      p.trustTales = clamp(p.trustTales - 30, -100, 100);
      pmem(p, w, `saw someone ${kind === 'copy' ? 'take another person’s face by touch' : 'change into ' + (formName || 'someone else')}`);
      if (p.role === 'ber_agent') agents++;
    }
    d.morale = clamp(d.morale - 4); d.cohesion = clamp(d.cohesion - 3); d.crime = clamp(d.crime + 2);
    d.berThreat = clamp(d.berThreat + 4 + agents * 12);
    w.player.repDistrict = clamp(w.player.repDistrict - Math.min(12, 2 + seers.length), -100, 100);
    w.player.berThreatTales = clamp(w.player.berThreatTales + 10 + agents * 25);
    w.player.timesSeenShifting = (w.player.timesSeenShifting || 0) + 1;
    addFact(w, { payload: 'someone on these blocks can wear other people’s faces', truth: true, virality: 70, confidence: 60 }, seers.map((p) => p.id));
    log(w, `${seers.length} ${seers.length === 1 ? 'person' : 'people'} saw the change. Fear ripples out.${agents ? ' A BER agent was watching.' : ''}`, 'fear');
    if (w.player.timesSeenShifting >= 2 || agents) ensureShapeshifterConflict(w);
    const crowd = seers.length === 1 ? seers[0].name + ' sees it happen' : seers.length <= 5 ? seers.length + ' people see it happen' : 'a crowd sees it happen';
    const text = agents ? 'A BER agent sees it happen — and does not look away.' : crowd + '; the fear is immediate.';
    return { seen: true, agents: agents, text: text };
  }
  // where a situation is best pursued (for place-based discovery + hints)
  function questPlace(key) {
    return ({ food_market: 'market', bad_water: 'safehouse', ber_pressure: 'checkpoint', despair: 'council', shapeshifter: 'apartments' })[key] || null;
  }
  function discoverByPlace(w, locId) {
    for (const q of w.quests) {
      if (q.discovered || q.state !== 'open') continue;
      const c = w.conflicts.find((x) => x.id === q.conflictId); if (!c) continue;
      if (questPlace(c.key) === locId) { q.discovered = true; log(w, `Being here, you piece together a situation: ${q.title}.`, 'quest'); }
    }
  }
  // suggested next step for a discovered situation (Quest Bible: guidance, not markers)
  function nextStep(w, q) {
    const c = w.conflicts.find((x) => x.id === q.conflictId);
    const prog = q.progress || 0;
    const map = {
      food_market: prog < 1 ? 'Investigate at the Corner Market to learn who’s taking a cut of the food.' : 'Now you know the shape of it: confront the crew (Fight), help restock the market (Help), or expose the shakedown with a Photograph.',
      bad_water: prog < 1 ? 'Ask around the Garden or Safe House about who always seems to know which water is safe.' : 'Find the hidden Changed, earn their trust, then copy their gift or help them steer people off the bad water.',
      ber_pressure: prog < 1 ? 'Talk to a BER agent at the Checkpoint, or the organizer at the Council, to learn what’s driving it.' : 'Lower the block’s disorder by Helping, or document the checkpoint with a Photograph to change the story.',
      despair: 'Show up where people gather — Help at the Council, Church, or Garden to lift morale.',
      shapeshifter: 'Fear of you is spreading. Stop transforming where people can see, rebuild trust (Talk, Help) — or lie low until it cools.',
    };
    return map[c ? c.key : q.key] || 'Look around and talk to people to learn more.';
  }

  /* --------------------------------------------------- save / load (L10) --*/
  function serialize(w) {
    // Sets/functions removed; RNG state re-seeded from seed + tick for determinism note.
    return JSON.stringify({
      seed: w.seed, tick: w.tick, day: w.day, hour: w.hour,
      district: w.district, player: w.player,
      locations: mapLoc(w.locations),
      people: w.people, facts: w.facts, conflicts: w.conflicts, quests: w.quests,
      storyLog: w.storyLog.slice(0, 120),
    });
    function mapLoc(ls) { const o = {}; for (const k in ls) { const { present, ...rest } = ls[k]; o[k] = rest; } return o; }
  }
  function deserialize(json) {
    const s = (typeof json === 'string') ? JSON.parse(json) : json;
    const w = createWorld(s.seed);
    Object.assign(w, { tick: s.tick, day: s.day, hour: s.hour, district: s.district, player: s.player, facts: s.facts, conflicts: s.conflicts, quests: s.quests, storyLog: s.storyLog });
    w.people = s.people; w.byId = {}; w.people.forEach((p) => (w.byId[p.id] = p));
    for (const k in s.locations) Object.assign(w.locations[k], s.locations[k], { present: [] });
    // recompute presence for current hour
    Sys.schedules(w);
    return w;
  }

  /* ------------------------------------------------------------- exports --*/
  const API = { createWorld, tick, step, Player, Battle, serialize, deserialize, CFG, LOC_DEFS, coLocated, here, nextStep, statsOf, hpOf, playerStats, innerThought, talentsOf, deepImprints };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TapWater = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
