mod progression;

use idlerite::{elapsed_seconds, Balance};
use progression::{Progression, FIGHTER_COUNT, GEAR};
use serde::{Deserialize, Serialize};

const SAVE_VERSION: u8 = 2;
const LEGACY_RIVALS: usize = 5;
const OFFLINE_LIMIT: u64 = 2 * 60 * 60;
const FULL_CHARGE: u8 = 5;
const MAX_LEVEL: u16 = 99;

struct Fighter {
    hp: u32,
    damage: u32,
}

const FIGHTERS: [Fighter; FIGHTER_COUNT] = [
    Fighter {
        hp: 110,
        damage: 16,
    },
    Fighter {
        hp: 145,
        damage: 12,
    },
    Fighter { hp: 90, damage: 20 },
];

struct Rival {
    hp: u32,
    damage: u32,
    reward: u64,
    xp: u32,
    guard: u32,
    burst_every: Option<u8>,
}

impl Rival {
    const fn new(
        hp: u32,
        damage: u32,
        reward: u64,
        xp: u32,
        guard: u32,
        burst_every: Option<u8>,
    ) -> Self {
        Self {
            hp,
            damage,
            reward,
            xp,
            guard,
            burst_every,
        }
    }

    fn counter(&self, strike: u8) -> u32 {
        if self.burst_every.is_some_and(|rate| strike % rate == 0) {
            self.damage * 3 / 2
        } else {
            self.damage
        }
    }
}

const RIVALS: [Rival; GEAR.len()] = [
    Rival::new(96, 9, 22, 20, 0, None),
    Rival::new(135, 13, 32, 29, 0, None),
    Rival::new(160, 17, 45, 39, 0, None),
    Rival::new(215, 21, 65, 54, 0, None),
    Rival::new(300, 26, 100, 76, 0, None),
    Rival::new(455, 33, 135, 108, 3, Some(4)),
    Rival::new(630, 41, 175, 140, 9, None),
    Rival::new(810, 55, 225, 185, 4, Some(3)),
    Rival::new(1_180, 64, 320, 260, 12, Some(4)),
];

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Outcome {
    #[default]
    Fighting,
    Knockout,
    Defeat,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    version: u8,
    fighter: usize,
    levels: [u16; FIGHTERS.len()],
    stage: usize,
    hp: u32,
    rival_hp: u32,
    coins: u64,
    wins: u64,
    charge: u8,
    outcome: Outcome,
    paused: bool,
    last_ms: u64,
    #[serde(default)]
    progression: Progression,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advance {
    seconds: u64,
    coins: u64,
    wins: u64,
    xp: u32,
    gear_earned: usize,
}

#[derive(Clone, Copy, Serialize)]
pub struct MarketGear {
    pub id: usize,
    pub rank: u8,
}

impl Game {
    pub fn new(now_ms: u64) -> Self {
        Self {
            version: SAVE_VERSION,
            fighter: 0,
            levels: [1; FIGHTERS.len()],
            stage: 0,
            hp: FIGHTERS[0].hp,
            rival_hp: RIVALS[0].hp,
            coins: 0,
            wins: 0,
            charge: 0,
            outcome: Outcome::Fighting,
            paused: false,
            last_ms: now_ms,
            progression: Progression::default(),
        }
    }

    fn level(&self) -> u16 {
        self.levels[self.fighter]
    }

    fn max_hp(&self) -> u32 {
        FIGHTERS[self.fighter].hp
            + 14 * (u32::from(self.level()) - 1)
            + self.progression.mastery_bonus(self.fighter) * 5
            + self.progression.stats(self.fighter).hp
    }

    fn damage(&self) -> u32 {
        FIGHTERS[self.fighter].damage
            + 4 * (u32::from(self.level()) - 1)
            + self.progression.mastery_bonus(self.fighter) * 2
            + self.progression.stats(self.fighter).attack
    }

    fn training_cost(&self) -> u64 {
        20 + 15 * (u64::from(self.level()) - 1)
    }

    pub fn from_save(save: &str) -> Option<Self> {
        let mut game: Self = serde_json::from_str(save).ok()?;
        if game.version == 1 && game.stage < LEGACY_RIVALS {
            game.version = SAVE_VERSION;
            let cleared = game.stage + usize::from(game.outcome == Outcome::Knockout);
            game.progression = Progression {
                highest_stage: cleared,
                ..Progression::default()
            };
            game.progression.gear[..cleared].fill(Some(0));
        }
        if !(game.version == SAVE_VERSION
            && game.fighter < FIGHTERS.len()
            && game.stage < RIVALS.len()
            && game.progression.valid(game.stage, RIVALS.len()))
            || game
                .levels
                .iter()
                .any(|level| !(1..=MAX_LEVEL).contains(level))
            || game.charge > FULL_CHARGE
            || game.hp > game.max_hp()
            || game.rival_hp > RIVALS[game.stage].hp
        {
            return None;
        }
        for (gear, claimed) in game
            .progression
            .gear
            .iter()
            .zip(&mut game.progression.claimed_gear)
        {
            *claimed |= gear.is_some();
        }
        Some(game)
    }

    pub fn coins(&self) -> u64 {
        self.coins
    }

    pub fn inventory(&self) -> impl Iterator<Item = (MarketGear, bool)> + '_ {
        self.progression
            .gear
            .iter()
            .enumerate()
            .filter_map(|(id, rank)| {
                Some((
                    MarketGear { id, rank: (*rank)? },
                    self.progression.wearer(id).is_some(),
                ))
            })
    }

    pub fn take_market_gear(&mut self, id: usize) -> Option<MarketGear> {
        if self.progression.wearer(id).is_some() {
            return None;
        }
        let rank = self.progression.gear.get_mut(id)?.take()?;
        self.progression.claimed_gear[id] = true;
        Some(MarketGear { id, rank })
    }

    pub fn receive_market_gear(&mut self, gear: MarketGear) -> bool {
        let Some(slot) = self.progression.gear.get_mut(gear.id) else {
            return false;
        };
        if slot.is_some() || gear.rank > progression::MAX_GEAR_RANK {
            return false;
        }
        *slot = Some(gear.rank);
        self.progression.claimed_gear[gear.id] = true;
        true
    }

    pub fn credit_market_coins(&mut self, amount: u64) -> bool {
        let Some(next) = self
            .coins
            .checked_add(amount)
            .filter(|next| *next < (1 << 53))
        else {
            return false;
        };
        self.coins = next;
        true
    }

    pub fn debit_market_coins(&mut self, amount: u64) -> bool {
        let Some(balance) = Balance::new(self.coins).debit(amount) else {
            return false;
        };
        self.coins = balance.amount();
        true
    }

    pub fn advance(&mut self, now_ms: u64) -> Advance {
        if now_ms < self.last_ms {
            return Advance::default();
        }
        if self.paused {
            self.last_ms = now_ms;
            return Advance::default();
        }

        let seconds = elapsed_seconds(self.last_ms, now_ms, OFFLINE_LIMIT);
        let before = (
            self.coins,
            self.wins,
            self.progression.xp[self.fighter],
            self.gear_count(),
        );
        for _ in 0..seconds {
            self.tick();
        }
        self.last_ms = if seconds == OFFLINE_LIMIT {
            now_ms
        } else {
            self.last_ms + seconds * 1_000
        };
        Advance {
            seconds,
            coins: self.coins - before.0,
            wins: self.wins - before.1,
            xp: self.progression.xp[self.fighter] - before.2,
            gear_earned: self.gear_count() - before.3,
        }
    }

    pub fn set_paused(&mut self, paused: bool, now_ms: u64) {
        self.advance(now_ms);
        self.paused = paused;
        self.last_ms = self.last_ms.max(now_ms);
    }

    pub fn train(&mut self) -> bool {
        if self.level() >= MAX_LEVEL {
            return false;
        }
        let Some(balance) = Balance::new(self.coins).debit(self.training_cost()) else {
            return false;
        };
        let previous_max = self.max_hp();
        self.coins = balance.amount();
        self.levels[self.fighter] += 1;
        if self.outcome == Outcome::Fighting {
            self.hp += self.max_hp() - previous_max;
        }
        true
    }

    pub fn select(&mut self, fighter: usize) -> bool {
        if fighter >= FIGHTERS.len() || fighter == self.fighter {
            return false;
        }
        if self.outcome == Outcome::Knockout {
            self.advance_stage();
        }
        self.fighter = fighter;
        self.charge = 0;
        self.start_round();
        true
    }

    pub fn special(&mut self) -> bool {
        if self.paused || self.charge < FULL_CHARGE || self.outcome != Outcome::Fighting {
            return false;
        }
        self.charge = 0;
        self.hit_rival(self.damage() * 3);
        if self.progression.technique(self.fighter, 1) {
            match self.fighter {
                0 if self.outcome == Outcome::Fighting => self.progression.special_turns = 3,
                1 if self.outcome == Outcome::Fighting => self.progression.special_turns = 2,
                2 => self.hp = (self.hp + self.max_hp() / 4).min(self.max_hp()),
                _ => (),
            }
        }
        true
    }

    pub fn select_rival(&mut self, stage: usize) -> bool {
        if stage > self.progression.highest_stage {
            return false;
        }
        self.progression.farming = true;
        if self.stage != stage {
            self.stage = stage;
            self.charge = 0;
            self.start_round();
        }
        true
    }

    pub fn advance_campaign(&mut self) -> bool {
        if !self.progression.farming {
            return false;
        }
        self.progression.farming = false;
        true
    }

    pub fn equip(&mut self, id: usize) -> bool {
        if !self.progression.gear.get(id).is_some_and(Option::is_some) {
            return false;
        }
        let slot = GEAR[id].slot.index();
        if let Some(wearer) = self.progression.wearer(id) {
            self.progression.equipment[wearer][slot] = None;
            if wearer == self.fighter {
                self.hp = self.hp.min(self.max_hp());
                return true;
            }
        }
        self.progression.equipment[self.fighter][slot] = Some(id);
        self.hp = self.hp.min(self.max_hp());
        true
    }

    pub fn upgrade_gear(&mut self, id: usize) -> bool {
        let Some(cost) = self.progression.upgrade_cost(id) else {
            return false;
        };
        let Some(balance) = Balance::new(self.coins).debit(cost) else {
            return false;
        };
        self.coins = balance.amount();
        self.progression.gear[id] = self.progression.gear[id].map(|rank| rank + 1);
        true
    }

    fn gear_count(&self) -> usize {
        self.progression.gear.iter().flatten().count()
    }

    fn tick(&mut self) {
        if self.outcome != Outcome::Fighting {
            if self.outcome == Outcome::Knockout {
                self.advance_stage();
            }
            self.start_round();
            return;
        }

        let strike = self.progression.strikes + 1;
        self.progression.strikes = strike % 12;
        let learned = self.progression.technique(self.fighter, 0);
        let charge = if self.fighter == 0 && learned && strike % 3 == 0 {
            2
        } else {
            1
        };
        self.charge = (self.charge + charge).min(FULL_CHARGE);
        let mut damage = self.damage();
        if self.fighter == 2 && learned && strike % 4 == 0 {
            damage = damage * 7 / 4;
        }
        if self.fighter == 0 && self.progression.special_turns > 0 {
            damage += self.damage() / 2;
        }
        self.hit_rival(damage);
        if self.outcome == Outcome::Fighting {
            let mut counter = RIVALS[self.stage]
                .counter(strike)
                .saturating_sub(self.progression.stats(self.fighter).guard)
                .max(1);
            if self.fighter == 1 && learned {
                counter = (counter * 3 / 4).max(1);
            }
            if self.fighter == 1 && self.progression.special_turns > 0 {
                counter = counter.div_ceil(2);
            }
            self.hp = self.hp.saturating_sub(counter);
            if self.hp == 0 {
                self.outcome = Outcome::Defeat;
                self.reward(4);
                self.progression
                    .add_xp(self.fighter, 5 + self.stage as u32 * 2);
            }
        }
        self.progression.special_turns = self.progression.special_turns.saturating_sub(1);
    }

    fn hit_rival(&mut self, damage: u32) {
        let rival = &RIVALS[self.stage];
        self.rival_hp = self
            .rival_hp
            .saturating_sub(damage.saturating_sub(rival.guard).max(1));
        if self.rival_hp == 0 {
            self.outcome = Outcome::Knockout;
            self.wins = self.wins.saturating_add(1);
            self.reward(rival.reward);
            self.progression.add_xp(self.fighter, rival.xp);
            if !self.progression.claimed_gear[self.stage] {
                self.progression.gear[self.stage].get_or_insert(0);
                self.progression.claimed_gear[self.stage] = true;
            }
            self.progression.highest_stage = self
                .progression
                .highest_stage
                .max((self.stage + 1).min(RIVALS.len() - 1));
        }
    }

    fn reward(&mut self, coins: u64) {
        if let Some(balance) = Balance::new(self.coins).credit(coins) {
            self.coins = balance.amount();
        }
    }

    fn advance_stage(&mut self) {
        if !self.progression.farming {
            self.stage = (self.stage + 1).min(RIVALS.len() - 1);
            self.progression.highest_stage = self.progression.highest_stage.max(self.stage);
        }
    }

    fn start_round(&mut self) {
        self.progression.strikes = 0;
        self.progression.special_turns = 0;
        self.hp = self.max_hp();
        self.rival_hp = RIVALS[self.stage].hp;
        self.outcome = Outcome::Fighting;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::{Advance, Game, FULL_CHARGE, MAX_LEVEL, RIVALS};
    use crate::progression::{Slot, Stats, FIGHTER_COUNT, GEAR, TECHNIQUE_XP};
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct View<'a> {
        #[serde(flatten)]
        game: &'a Game,
        max_hp: u32,
        rival_max_hp: u32,
        damage: u32,
        training_cost: Option<u64>,
        full_charge: u8,
        mastery: [u32; FIGHTER_COUNT],
        technique_xp: [u32; 2],
        inventory: Vec<Item>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Item {
        id: usize,
        slot: Slot,
        rank: u8,
        stats: Stats,
        wearer: Option<usize>,
        upgrade_cost: Option<u64>,
    }

    fn json(value: &impl Serialize) -> Result<String, JsValue> {
        serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen]
    pub struct Arena(Game);

    #[wasm_bindgen]
    impl Arena {
        #[wasm_bindgen(constructor)]
        pub fn new(now_ms: u64, save: Option<String>) -> Result<Arena, JsValue> {
            match save {
                Some(save) => Game::from_save(&save)
                    .map(Self)
                    .ok_or_else(|| JsValue::from_str("Invalid or unsupported save")),
                None => Ok(Self(Game::new(now_ms))),
            }
        }

        pub fn view(&self) -> Result<String, JsValue> {
            json(&View {
                game: &self.0,
                max_hp: self.0.max_hp(),
                rival_max_hp: RIVALS[self.0.stage].hp,
                damage: self.0.damage(),
                training_cost: (self.0.level() < MAX_LEVEL).then(|| self.0.training_cost()),
                full_charge: FULL_CHARGE,
                mastery: std::array::from_fn(|index| self.0.progression.mastery_bonus(index) + 1),
                technique_xp: TECHNIQUE_XP,
                inventory: self
                    .0
                    .progression
                    .gear
                    .iter()
                    .enumerate()
                    .filter_map(|(id, rank)| {
                        let rank = (*rank)?;
                        let gear = GEAR[id];
                        Some(Item {
                            id,
                            slot: gear.slot,
                            rank,
                            stats: gear.stats(rank),
                            wearer: self.0.progression.wearer(id),
                            upgrade_cost: self.0.progression.upgrade_cost(id),
                        })
                    })
                    .collect(),
            })
        }

        pub fn save(&self) -> Result<String, JsValue> {
            json(&self.0)
        }

        pub fn advance(&mut self, now_ms: u64) -> Result<String, JsValue> {
            let advance: Advance = self.0.advance(now_ms);
            json(&advance)
        }

        pub fn set_paused(&mut self, paused: bool, now_ms: u64) {
            self.0.set_paused(paused, now_ms);
        }

        pub fn train(&mut self) -> bool {
            self.0.train()
        }

        pub fn select(&mut self, fighter: usize) -> bool {
            self.0.select(fighter)
        }

        pub fn special(&mut self) -> bool {
            self.0.special()
        }

        pub fn select_rival(&mut self, stage: usize) -> bool {
            self.0.select_rival(stage)
        }

        pub fn advance_campaign(&mut self) -> bool {
            self.0.advance_campaign()
        }

        pub fn equip(&mut self, id: usize) -> bool {
            self.0.equip(id)
        }

        pub fn upgrade_gear(&mut self, id: usize) -> bool {
            self.0.upgrade_gear(id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_win_funds_training_and_advances_the_ladder() {
        let mut game = Game::new(0);
        assert_eq!(game.advance(6_000).wins, 1);
        assert_eq!(game.coins, 22);
        assert!(game.train());
        assert_eq!((game.level(), game.coins), (2, 2));
        assert_eq!(game.advance(7_000).wins, 0);
        assert_eq!((game.stage, game.hp, game.rival_hp), (1, 124, 135));
        assert!(game.select(1));
        assert_eq!((game.stage, game.hp, game.level()), (1, 145, 1));
    }

    #[test]
    fn offline_simulation_is_capped_and_cannot_be_reapplied_after_loading() {
        let mut game = Game::new(0);
        let now = 24 * 60 * 60 * 1_000;
        assert_eq!(game.advance(now).seconds, OFFLINE_LIMIT);
        let mut restored = Game::from_save(&serde_json::to_string(&game).unwrap()).unwrap();
        let repeated = restored.advance(now);
        assert_eq!(
            (repeated.coins, repeated.xp, repeated.gear_earned),
            (0, 0, 0)
        );
        assert_eq!(restored.coins, game.coins);
        assert_eq!(restored.progression.xp, game.progression.xp);
        assert_eq!(restored.advance(now - 5_000).seconds, 0);
    }

    #[test]
    fn legacy_save_keeps_the_current_fight_and_unlocks_previous_rivals() {
        let old = r#"{"version":1,"fighter":1,"levels":[5,8,2],"stage":4,"hp":180,"rivalHp":101,"coins":85,"wins":21,"charge":4,"outcome":"fighting","paused":false,"lastMs":5000}"#;
        let mut game = Game::from_save(old).unwrap();
        assert_eq!(
            (game.version, game.hp, game.rival_hp, game.coins),
            (2, 180, 101, 85)
        );
        assert_eq!(game.levels, [5, 8, 2]);
        assert_eq!(game.progression.xp, [0; FIGHTER_COUNT]);
        assert_eq!(game.gear_count(), 4);
        assert!(!game.select_rival(5));
        assert!(game.select_rival(2));
        assert_eq!(game.progression.highest_stage, 4);
        assert!(game.progression.farming);
    }

    #[test]
    fn farming_awards_experience_without_duplicating_or_resetting_gear() {
        let mut game = Game::new(0);
        assert!(game.select_rival(0));
        let first = game.advance(6_000);
        assert_eq!((first.wins, first.xp, first.gear_earned), (1, 20, 1));
        assert!(game.equip(0));
        assert_eq!(game.damage(), 21);
        game.coins = 25;
        assert!(game.upgrade_gear(0));
        assert_eq!(game.damage(), 22);
        let repeat = game.advance(12_000);
        assert_eq!((repeat.wins, repeat.xp, repeat.gear_earned), (1, 20, 0));
        assert_eq!(game.progression.gear[0], Some(1));
        assert_eq!(game.stage, 0);
        assert!(game.advance_campaign());
        game.advance(13_000);
        assert_eq!(game.stage, 1);
    }

    #[test]
    fn equipment_transfers_without_healing_or_duplicating() {
        let mut game = Game::new(0);
        game.progression.gear[1] = Some(0);
        assert!(game.equip(1));
        assert_eq!((game.max_hp(), game.hp), (134, 110));
        assert!(game.select(2));
        assert!(game.equip(1));
        assert_eq!(game.progression.wearer(1), Some(2));
        assert_eq!((game.max_hp(), game.hp), (114, 90));
        assert!(game.equip(1));
        assert_eq!(game.progression.wearer(1), None);
        game.progression.equipment[0][0] = Some(1);
        assert!(Game::from_save(&serde_json::to_string(&game).unwrap()).is_none());
    }

    #[test]
    fn a_listed_first_win_drop_cannot_be_farmed_again() {
        let mut game = Game::new(0);
        assert!(game.select_rival(0));
        assert_eq!(game.advance(6_000).gear_earned, 1);
        let item = game.take_market_gear(0).unwrap();
        let mut restored = Game::from_save(&serde_json::to_string(&game).unwrap()).unwrap();
        assert_eq!(restored.advance(13_000).wins, 1);
        assert_eq!(restored.inventory().count(), 0);
        assert!(restored.receive_market_gear(item));
        assert!(!restored.receive_market_gear(item));
    }

    #[test]
    fn techniques_are_distinct_and_bound_to_the_active_fighter() {
        let mut game = Game::new(0);
        game.stage = 5;
        game.progression.highest_stage = 5;
        game.progression.xp = [160, 160, 160];
        game.levels = [8; FIGHTER_COUNT];
        game.start_round();
        game.tick();
        game.tick();
        game.tick();
        assert_eq!(game.charge, 4);
        game.tick();
        assert!(game.special());
        let health = game.rival_hp;
        let reinforced = (game.damage() + game.damage() / 2) - RIVALS[5].guard;
        game.tick();
        assert_eq!(health - game.rival_hp, reinforced);
        assert_eq!(game.progression.special_turns, 2);

        assert!(game.select(1));
        assert_eq!(game.progression.special_turns, 0);
        game.charge = FULL_CHARGE;
        assert!(game.special());
        let hp = game.hp;
        game.tick();
        assert_eq!(hp - game.hp, 12);

        assert!(game.select(2));
        game.progression.strikes = 3;
        let health = game.rival_hp;
        game.tick();
        assert_eq!(
            health - game.rival_hp,
            game.damage() * 7 / 4 - RIVALS[5].guard
        );
        game.charge = FULL_CHARGE;
        let hp = game.hp;
        assert!(game.special());
        assert_eq!(game.hp, hp + game.max_hp() / 4);
    }

    #[test]
    fn training_and_equipment_can_clear_every_rival_with_any_fighter() {
        for fighter in 0..FIGHTER_COUNT {
            let mut game = Game::new(0);
            game.select(fighter);
            for _ in 0..OFFLINE_LIMIT {
                game.train();
                for id in 0..GEAR.len() {
                    if game.progression.gear[id].is_some()
                        && game.progression.equipment[fighter][GEAR[id].slot.index()]
                            .is_none_or(|current| current < id)
                    {
                        game.equip(id);
                    }
                }
                game.special();
                game.tick();
                if game.gear_count() == RIVALS.len() {
                    break;
                }
            }
            assert_eq!(game.gear_count(), RIVALS.len(), "fighter {fighter}");
        }
    }

    #[test]
    fn special_consumes_charge_and_pause_freezes_combat() {
        let mut game = Game::new(0);
        game.advance(5_000);
        assert!(game.special());
        assert_eq!(game.rival_hp, 0);
        assert_eq!(game.charge, 0);
        assert!(!game.special());
        game.set_paused(true, 5_000);
        assert_eq!(game.advance(1_000_000).seconds, 0);
        game.set_paused(false, 1_000_001);
        assert_eq!(game.advance(1_001_001).seconds, 1);
        assert_eq!(game.stage, 1);
    }
}
