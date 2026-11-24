use idlerite::{elapsed_seconds, Balance};
use serde::{Deserialize, Serialize};

const SAVE_VERSION: u8 = 1;
const OFFLINE_LIMIT: u64 = 2 * 60 * 60;
const FULL_CHARGE: u8 = 5;
const MAX_LEVEL: u16 = 99;

struct Fighter {
    hp: u32,
    damage: u32,
}

const FIGHTERS: [Fighter; 3] = [
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
}

const RIVALS: [Rival; 5] = [
    Rival {
        hp: 96,
        damage: 9,
        reward: 22,
    },
    Rival {
        hp: 135,
        damage: 13,
        reward: 32,
    },
    Rival {
        hp: 160,
        damage: 17,
        reward: 45,
    },
    Rival {
        hp: 215,
        damage: 21,
        reward: 65,
    },
    Rival {
        hp: 300,
        damage: 26,
        reward: 100,
    },
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
}

#[derive(Default, Serialize)]
pub struct Advance {
    seconds: u64,
    coins: u64,
    wins: u64,
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
        }
    }

    fn level(&self) -> u16 {
        self.levels[self.fighter]
    }

    fn max_hp(&self) -> u32 {
        FIGHTERS[self.fighter].hp + 14 * (u32::from(self.level()) - 1)
    }

    fn damage(&self) -> u32 {
        FIGHTERS[self.fighter].damage + 4 * (u32::from(self.level()) - 1)
    }

    fn training_cost(&self) -> u64 {
        20 + 15 * (u64::from(self.level()) - 1)
    }

    pub fn from_save(save: &str) -> Option<Self> {
        let game: Self = serde_json::from_str(save).ok()?;
        if game.version != SAVE_VERSION
            || game.fighter >= FIGHTERS.len()
            || game.stage >= RIVALS.len()
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
        Some(game)
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
        let before = (self.coins, self.wins);
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
        true
    }

    fn tick(&mut self) {
        if self.outcome != Outcome::Fighting {
            if self.outcome == Outcome::Knockout {
                self.advance_stage();
            }
            self.start_round();
            return;
        }

        self.charge = (self.charge + 1).min(FULL_CHARGE);
        self.hit_rival(self.damage());
        if self.outcome == Outcome::Fighting {
            self.hp = self.hp.saturating_sub(RIVALS[self.stage].damage);
            if self.hp == 0 {
                self.outcome = Outcome::Defeat;
                self.reward(4);
            }
        }
    }

    fn hit_rival(&mut self, damage: u32) {
        self.rival_hp = self.rival_hp.saturating_sub(damage);
        if self.rival_hp == 0 {
            self.outcome = Outcome::Knockout;
            self.wins = self.wins.saturating_add(1);
            self.reward(RIVALS[self.stage].reward);
        }
    }

    fn reward(&mut self, coins: u64) {
        if let Some(balance) = Balance::new(self.coins).credit(coins) {
            self.coins = balance.amount();
        }
    }

    fn advance_stage(&mut self) {
        self.stage = (self.stage + 1).min(RIVALS.len() - 1);
    }

    fn start_round(&mut self) {
        self.hp = self.max_hp();
        self.rival_hp = RIVALS[self.stage].hp;
        self.outcome = Outcome::Fighting;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::{Advance, Game, FULL_CHARGE, MAX_LEVEL, RIVALS};
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
        assert_eq!(restored.advance(now).coins, 0);
        assert_eq!(restored.coins, game.coins);
        assert_eq!(restored.advance(now - 5_000).seconds, 0);
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
