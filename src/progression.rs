use serde::{Deserialize, Serialize};

pub(crate) const FIGHTER_COUNT: usize = 3;
pub(crate) const MAX_GEAR_RANK: u8 = 5;
pub(crate) const MAX_XP: u32 = 1_000_000_000;
pub(crate) const TECHNIQUE_XP: [u32; 2] = [45, 160];

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Slot {
    Wraps,
    Charm,
}

impl Slot {
    pub(crate) fn index(self) -> usize {
        match self {
            Self::Wraps => 0,
            Self::Charm => 1,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Gear {
    pub(crate) slot: Slot,
    attack: u32,
    hp: u32,
    guard: u32,
}

impl Gear {
    const fn new(slot: Slot, attack: u32, hp: u32, guard: u32) -> Self {
        Self {
            slot,
            attack,
            hp,
            guard,
        }
    }

    pub(crate) fn stats(self, rank: u8) -> Stats {
        let multiplier = 5 + u32::from(rank);
        Stats {
            attack: self.attack * multiplier / 5,
            hp: self.hp * multiplier / 5,
            guard: self.guard * multiplier / 5,
        }
    }
}

pub(crate) const GEAR: [Gear; 9] = [
    Gear::new(Slot::Wraps, 5, 0, 0),
    Gear::new(Slot::Charm, 0, 24, 0),
    Gear::new(Slot::Wraps, 8, 12, 0),
    Gear::new(Slot::Charm, 0, 15, 4),
    Gear::new(Slot::Wraps, 14, 0, 0),
    Gear::new(Slot::Charm, 4, 25, 3),
    Gear::new(Slot::Wraps, 15, 0, 3),
    Gear::new(Slot::Charm, 10, 18, 0),
    Gear::new(Slot::Charm, 9, 42, 5),
];

#[derive(Default, Serialize)]
pub(crate) struct Stats {
    pub(crate) attack: u32,
    pub(crate) hp: u32,
    pub(crate) guard: u32,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Progression {
    pub(crate) xp: [u32; FIGHTER_COUNT],
    pub(crate) highest_stage: usize,
    pub(crate) farming: bool,
    pub(crate) gear: [Option<u8>; GEAR.len()],
    pub(crate) claimed_gear: [bool; GEAR.len()],
    pub(crate) equipment: [[Option<usize>; 2]; FIGHTER_COUNT],
    pub(crate) strikes: u8,
    pub(crate) special_turns: u8,
}

impl Progression {
    pub(crate) fn valid(&self, stage: usize, rival_count: usize) -> bool {
        if self.highest_stage < stage
            || self.highest_stage >= rival_count
            || self.xp.iter().any(|&xp| xp > MAX_XP)
            || self.gear.iter().flatten().any(|&rank| rank > MAX_GEAR_RANK)
            || self.strikes >= 12
            || self.special_turns > 3
        {
            return false;
        }

        let mut assigned = [false; GEAR.len()];
        for loadout in self.equipment {
            for (slot, id) in loadout.into_iter().enumerate() {
                let Some(id) = id else { continue };
                if id >= GEAR.len()
                    || self.gear[id].is_none()
                    || GEAR[id].slot.index() != slot
                    || assigned[id]
                {
                    return false;
                }
                assigned[id] = true;
            }
        }
        true
    }

    pub(crate) fn add_xp(&mut self, fighter: usize, xp: u32) {
        self.xp[fighter] = (self.xp[fighter] + xp).min(MAX_XP);
    }

    pub(crate) fn technique(&self, fighter: usize, tier: usize) -> bool {
        self.xp[fighter] >= TECHNIQUE_XP[tier]
    }

    pub(crate) fn mastery_bonus(&self, fighter: usize) -> u32 {
        (self.xp[fighter] / TECHNIQUE_XP[0]).isqrt().min(20)
    }

    pub(crate) fn wearer(&self, id: usize) -> Option<usize> {
        self.equipment
            .iter()
            .position(|slots| slots.contains(&Some(id)))
    }

    pub(crate) fn stats(&self, fighter: usize) -> Stats {
        let mut total = Stats::default();
        for &id in self.equipment[fighter].iter().flatten() {
            let stats = GEAR[id].stats(self.gear[id].unwrap());
            total.attack += stats.attack;
            total.hp += stats.hp;
            total.guard += stats.guard;
        }
        total
    }

    pub(crate) fn upgrade_cost(&self, id: usize) -> Option<u64> {
        let rank = self.gear.get(id).copied().flatten()?;
        (rank < MAX_GEAR_RANK).then(|| 25 * (u64::from(rank) + 1) + 8 * id as u64)
    }
}
