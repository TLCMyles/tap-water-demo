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
        })[c.key] || 'Investigation';
        w.quests.push({
          id: uid('q'), conflictId: c.id, key: c.key, archetype,
          title: c.desc, discovered: false, state: 'open', bornTick: w.tick,
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
    talk(w, id) {
      const p = w.byId[id]; if (!p || p.locId !== w.player.locId) return { ok: false, msg: 'they are not here' };
      p.trustTales = clamp(p.trustTales + 8, -100, 100);
      w.player.repDistrict = clamp(w.player.repDistrict + 1, -100, 100);
      // learn what they know (a fact)
      const fids = Object.keys(p.knows);
      let learned = '';
      if (fids.length) { const f = w.facts.find((x) => x.id === w.rng.pick(fids)); if (f) { w.player.knows[f.id] = p.knows[f.id]; learned = ` They mention: “${f.payload}.”`; } }
      discoverQuestsFor(w, p);
      step(w, 1);
      let extra = '';
      if (p.hidden && p.trustTales > 30) { extra = ` ${p.name} lowers their voice — they trust you with something (they are Changed).`; }
      return { ok: true, msg: `You talk with ${p.name}. Trust grows.${learned}${extra}` };
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
      w.player.berThreatTales = clamp(w.player.berThreatTales + 8);   // visible power use
      let gain = 'their face, skills, and memories';
      if (p.ability === 'sense_contamination') gain = 'their hidden ability to sense bad water';
      log(w, `You copy ${p.name}. A new Imprint takes root (${gain}). Someone may have seen.`, 'mimicry');
      w.player.actions++; step(w, 1);
      return { ok: true, msg: `Skin contact — you copy ${p.name}. You gain ${gain}. Identity strain rises.` };
    },
    wear(w, id) {
      if (!w.player.imprints.includes(id)) return { ok: false, msg: 'you have no imprint of them' };
      w.player.form = id; const p = w.byId[id];
      w.player.strain = clamp(w.player.strain + 3);
      return { ok: true, msg: `You take on ${p.name}'s form. You now wear their local reputation.` };
    },
    revert(w) { w.player.form = null; return { ok: true, msg: 'You return to yourself — the hardest form to wear.' }; },
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
  const API = { createWorld, tick, step, Player, serialize, deserialize, CFG, LOC_DEFS, coLocated, here };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TapWater = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
