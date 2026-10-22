/**
 * The author's roster (docs/SPECIES.md, from Race_Stats_40_With_Leaping_AutoTotals.xlsx): every
 * sentient species and its races, with the sheet's stats. Missing values are left empty (null)
 * for the author to fill in; nothing is guessed.
 */
export interface RosterRace { name: string; size: string | null; stats: (number | null)[]; fightingAge: number | null; lifespan: number | null; affinity: string; affinity2: string; specialty: string; notes: string }
export interface RosterSpecies { name: string; kind: string; setAside: boolean; notes: string; traits: string[]; movement: string[]; races: RosterRace[] }

export const ROSTER: RosterSpecies[] = [
 {
  "name": "Human",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Human",
    "size": "Medium",
    "stats": [
     16,
     0,
     10,
     10,
     14,
     6,
     10,
     10,
     30,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": 18,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "Audacity of Man",
    "notes": ""
   },
   {
    "name": "Hatarin",
    "size": "Medium",
    "stats": [
     16,
     0,
     12,
     12,
     10,
     6,
     10,
     10,
     35,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Elf",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Elf",
    "size": "Medium",
    "stats": [
     14,
     0,
     6,
     14,
     10,
     6,
     14,
     9,
     45,
     8,
     35,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Elemental",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Winter Elves",
    "size": "Small",
    "stats": [
     14,
     0,
     10,
     10,
     10,
     2,
     10,
     10,
     30,
     8,
     30,
     0,
     0,
     2,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Dwarf",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "Dig tunnels.",
  "traits": [
   "tunneler"
  ],
  "movement": [
   "Walks",
   "Digs"
  ],
  "races": [
   {
    "name": "Dwarf",
    "size": "Medium",
    "stats": [
     18,
     4,
     14,
     4,
     10,
     8,
     10,
     10,
     10,
     6,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Earth, Artificer",
    "affinity2": "Fire",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Orc",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Orc",
    "size": "Large",
    "stats": [
     20,
     4,
     14,
     8,
     10,
     8,
     4,
     6,
     12,
     4,
     30,
     0,
     2,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Minotaur",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Minitour",
    "size": "Large",
    "stats": [
     25,
     10,
     16,
     8,
     10,
     10,
     0,
     8,
     40,
     6,
     40,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Lora'An",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Lora'An",
    "size": "Medium",
    "stats": [
     16,
     0,
     8,
     10,
     10,
     6,
     12,
     12,
     0,
     8,
     35,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Lykin",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Lykin",
    "size": "Medium",
    "stats": [
     18,
     0,
     8,
     10,
     10,
     6,
     10,
     12,
     30,
     8,
     35,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Jumper Aulis",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Jumper Aulis",
    "size": "Medium",
    "stats": [
     20,
     4,
     10,
     10,
     10,
     6,
     10,
     10,
     30,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Void",
    "affinity2": "Arcain",
    "specialty": "Telaport, Magic decay.",
    "notes": ""
   }
  ]
 },
 {
  "name": "Porcupine-folk",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Porkipines",
    "size": "Medium",
    "stats": [
     14,
     0,
     10,
     10,
     10,
     2,
     10,
     10,
     30,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Twittele leaf",
  "kind": "Humanoid",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Twittele leaf",
    "size": "Small",
    "stats": [
     10,
     0,
     10,
     10,
     2,
     1,
     10,
     10,
     30,
     8,
     10,
     0,
     0,
     2,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Ory",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "The Rabbit race: shogunate-inspired government (an emperor of the true line, a military ruler and great lords). Dig tunnels.",
  "traits": [
   "tunneler"
  ],
  "movement": [
   "Walks",
   "Digs"
  ],
  "races": [
   {
    "name": "Ory",
    "size": "Medium",
    "stats": [
     14,
     0,
     6,
     16,
     8,
     4,
     12,
     14,
     20,
     8,
     40,
     0,
     0,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Bear-folk",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Bear people",
    "size": "Large",
    "stats": [
     30,
     10,
     18,
     4,
     12,
     12,
     6,
     10,
     10,
     4,
     25,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "GoatBear",
    "size": "Large",
    "stats": [
     30,
     4,
     18,
     8,
     12,
     10,
     6,
     10,
     10,
     6,
     35,
     0,
     25,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Canasalora",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Canasalora",
    "size": "Medium",
    "stats": [
     18,
     0,
     14,
     8,
     12,
     6,
     10,
     10,
     20,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Moon",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Catary",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Catary",
    "size": "Medium",
    "stats": [
     18,
     0,
     10,
     14,
     12,
     6,
     10,
     10,
     20,
     8,
     30,
     0,
     20,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Wild, Life",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Centaur",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Centur",
    "size": "Large",
    "stats": [
     25,
     0,
     16,
     8,
     12,
     8,
     0,
     8,
     20,
     8,
     60,
     0,
     0,
     15,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Halfling",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Halfling",
    "size": "Small",
    "stats": [
     12,
     0,
     4,
     11,
     12,
     2,
     12,
     12,
     40,
     8,
     20,
     0,
     3,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Rodent-folk",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Molycin (Mice)",
    "size": "Small",
    "stats": [
     10,
     0,
     12,
     12,
     4,
     2,
     10,
     10,
     20,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Retacy (Ratmen)",
    "size": "Medium",
    "stats": [
     14,
     0,
     12,
     12,
     12,
     2,
     10,
     10,
     20,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Kuma-Vel (Ratkoon)",
    "size": "Medium",
    "stats": [
     14,
     0,
     12,
     12,
     12,
     4,
     10,
     10,
     20,
     8,
     30,
     0,
     20,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Moostifarion",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Moostifarion",
    "size": "Large",
    "stats": [
     35,
     4,
     12,
     6,
     12,
     8,
     10,
     10,
     10,
     6,
     40,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Roxet",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Roxet (Lizzard cat likes)",
    "size": "Medium",
    "stats": [
     18,
     4,
     12,
     12,
     12,
     8,
     10,
     10,
     20,
     6,
     30,
     0,
     35,
     15,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Squirrel-folk",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Squerls",
    "size": "Small",
    "stats": [
     14,
     0,
     12,
     12,
     12,
     4,
     10,
     10,
     20,
     8,
     40,
     0,
     30,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Flying Squerls",
    "size": "Small",
    "stats": [
     14,
     0,
     12,
     12,
     12,
     4,
     10,
     10,
     20,
     8,
     40,
     0,
     30,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Battle",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Velitrix",
  "kind": "Mammalian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Velitrix",
    "size": "Medium",
    "stats": [
     18,
     6,
     14,
     12,
     12,
     8,
     8,
     8,
     10,
     6,
     40,
     0,
     30,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "Primal Audacity",
    "notes": ""
   }
  ]
 },
 {
  "name": "Bird-folk",
  "kind": "Avian",
  "setAside": false,
  "notes": "Their own Avian kind. Fly, live in giant trees and hunt from them. Owls, Seagulls, Eagles, Falcons, Crows and Ravens need stats.",
  "traits": [
   "avian"
  ],
  "movement": [
   "Walks",
   "Flies",
   "Tree-dwelling"
  ],
  "races": [
   {
    "name": "Bird people",
    "size": "Medium",
    "stats": [
     14,
     0,
     4,
     16,
     6,
     4,
     10,
     10,
     20,
     8,
     30,
     60,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Air",
    "affinity2": "Water",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Owls",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Seagulls",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Eagles",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Falcons",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Crows",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Ravens",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Capra",
  "kind": "Capra",
  "setAside": false,
  "notes": "The goat-like race: can cross high mountains and build settlements on mountainsides.",
  "traits": [
   "mountain-born"
  ],
  "movement": [
   "Walks",
   "Climbs",
   "Mountain-adapted"
  ],
  "races": [
   {
    "name": "Capra",
    "size": "Medium",
    "stats": [
     18,
     4,
     12,
     6,
     10,
     6,
     10,
     10,
     20,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Stone, Water",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Crocodile-folk",
  "kind": "Reptilian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Crocadile",
    "size": "Large",
    "stats": [
     45,
     20,
     18,
     6,
     14,
     14,
     4,
     6,
     10,
     4,
     25,
     0,
     0,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Water, Wild",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Dragonkin",
  "kind": "Reptilian",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Dragonkin",
    "size": "Large",
    "stats": [
     20,
     4,
     14,
     10,
     14,
     8,
     10,
     11,
     35,
     6,
     30,
     20,
     5,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Elimental based on race",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Lizard-folk",
  "kind": "Reptilian",
  "setAside": false,
  "notes": "TacTu use fungus with trees to make homes and walls.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "TacTu",
    "size": "Small",
    "stats": [
     12,
     0,
     2,
     16,
     10,
     2,
     8,
     8,
     10,
     8,
     30,
     0,
     0,
     2,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": "small like people living in the jungels they are the ones who uses the fungus with trees to make homes and walls"
   },
   {
    "name": "Tazac Basic Liverd folk",
    "size": "Medium",
    "stats": [
     14,
     4,
     6,
     12,
     10,
     4,
     2,
     4,
     15,
     8,
     30,
     0,
     0,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Spider-folk",
  "kind": "Insectoid",
  "setAside": false,
  "notes": "Prefer deep forests; can live in the Underdark but don’t mine it; incredibly solitary; hunt the insect races (ants, bees, termites). Needs stats.",
  "traits": [
   "night-eyed"
  ],
  "movement": [],
  "races": [
   {
    "name": "Spider-folk",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Ant-folk",
  "kind": "Insectoid",
  "setAside": false,
  "notes": "Sentient insect race. Needs stats.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Ant-folk",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Bee-folk",
  "kind": "Insectoid",
  "setAside": false,
  "notes": "Sentient insect race. Needs stats.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Bee-folk",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Termite-folk",
  "kind": "Insectoid",
  "setAside": false,
  "notes": "Sentient insect race. Needs stats.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Termite-folk",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Fay",
  "kind": "Fay",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Fay",
    "size": "Medium",
    "stats": [
     16,
     2,
     8,
     16,
     8,
     6,
     12,
     14,
     60,
     6,
     40,
     0,
     0,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Primal",
    "affinity2": "Elemental",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Fairy",
    "size": "Tiny",
    "stats": [
     5,
     0,
     4,
     10,
     2,
     0,
     10,
     10,
     80,
     8,
     5,
     35,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Primal",
    "affinity2": "Elemental",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Feylora",
    "size": "Medium",
    "stats": [
     16,
     0,
     10,
     10,
     10,
     0,
     10,
     10,
     80,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Primal",
    "affinity2": "Elemental",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Lantu Fay (Big ass fay)",
    "size": "Giant",
    "stats": [
     60,
     8,
     20,
     8,
     20,
     18,
     8,
     10,
     60,
     10,
     100,
     0,
     45,
     45,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Primal",
    "affinity2": "Elemental",
    "specialty": "Wild Gate walkers, Ancesteral magic",
    "notes": ""
   }
  ]
 },
 {
  "name": "Phaun",
  "kind": "Fay",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Phaun",
    "size": "Medium",
    "stats": [
     18,
     0,
     10,
     10,
     14,
     4,
     10,
     10,
     30,
     8,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Dryad",
  "kind": "Dryad",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Dryaid",
    "size": "Large",
    "stats": [
     25,
     6,
     14,
     8,
     12,
     6,
     8,
     8,
     50,
     4,
     20,
     0,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Life, Earth",
    "affinity2": "Death",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Dryaid (Brambelwood)",
    "size": "Large",
    "stats": [
     35,
     8,
     14,
     10,
     12,
     6,
     10,
     10,
     30,
     4,
     30,
     0,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Earth, Death",
    "affinity2": "Life",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Dryaid (Ironwood)",
    "size": "Large",
    "stats": [
     35,
     10,
     16,
     10,
     14,
     8,
     10,
     10,
     30,
     4,
     30,
     0,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Life, Earth",
    "affinity2": "Death",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Dryaid (Ivory)",
    "size": "Large",
    "stats": [
     20,
     4,
     12,
     10,
     12,
     4,
     10,
     10,
     30,
     4,
     30,
     20,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Life, Chaos",
    "affinity2": "Earth, Death",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Giants",
  "kind": "Giants",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Giants",
    "size": "Giant",
    "stats": [
     60,
     20,
     20,
     6,
     16,
     18,
     6,
     6,
     10,
     4,
     30,
     0,
     0,
     15,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Elimental based on race",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Eliphantae",
  "kind": "Giants",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Eliphantae",
    "size": "Giant",
    "stats": [
     45,
     10,
     20,
     4,
     18,
     14,
     8,
     14,
     20,
     4,
     20,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Mistic",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Gargoyle",
  "kind": "Construct",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Gargoyals",
    "size": "Large",
    "stats": [
     40,
     18,
     16,
     8,
     18,
     8,
     10,
     10,
     0,
     4,
     20,
     35,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "None",
    "affinity2": "None",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Toy Soldier",
  "kind": "Construct",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "ToySolders",
    "size": "Medium",
    "stats": [
     25,
     6,
     16,
     8,
     0,
     0,
     10,
     10,
     0,
     2,
     20,
     0,
     0,
     0,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Vasaleth",
  "kind": "Construct",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Vasaleth (Lora'an constructs)",
    "size": "Large",
    "stats": [
     60,
     30,
     28,
     18,
     0,
     16,
     16,
     16,
     0,
     10,
     60,
     0,
     35,
     35,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Runic Enchantments",
    "affinity2": "None",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Shwana",
  "kind": "Fishman",
  "setAside": false,
  "notes": "Sea folk.",
  "traits": [
   "seafarer"
  ],
  "movement": [
   "Walks",
   "Swims"
  ],
  "races": [
   {
    "name": "Shwana",
    "size": "Large",
    "stats": [
     35,
     10,
     18,
     16,
     14,
     14,
     10,
     12,
     45,
     12,
     45,
     0,
     25,
     20,
     60
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": "SEA Folk"
   }
  ]
 },
 {
  "name": "Taluty",
  "kind": "Other",
  "setAside": false,
  "notes": "Small jungle people living in small communities; great clockmakers and spies.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Taluty",
    "size": null,
    "stats": [
     5,
     0,
     4,
     10,
     2,
     1,
     16,
     16,
     20,
     16,
     10,
     0,
     10,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": "Small huminoids commonly living in jungels, great clock makers and spys."
   }
  ]
 },
 {
  "name": "Rathy",
  "kind": "Other",
  "setAside": false,
  "notes": "",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Rathy",
    "size": "Large",
    "stats": [
     16,
     14,
     10,
     10,
     10,
     14,
     0,
     0,
     100,
     8,
     40,
     0,
     0,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Nova",
  "kind": "Nova",
  "setAside": true,
  "notes": "Very special: relies on other aspects of the world. Set aside for later.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Dream",
    "size": null,
    "stats": [
     0,
     0,
     15,
     20,
     0,
     10,
     20,
     20,
     100,
     8,
     30,
     30,
     30,
     10,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "Chaos",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Honor",
    "size": "Medium",
    "stats": [
     60,
     10,
     15,
     15,
     10,
     8,
     12,
     12,
     80,
     10,
     35,
     0,
     0,
     15,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   },
   {
    "name": "Wrath",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 },
 {
  "name": "Zatatari",
  "kind": "Other",
  "setAside": true,
  "notes": "Magic hunters (were Fay but switched sides). Set aside for later.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Zatatari (magic hunters)",
    "size": "Large",
    "stats": [
     25,
     10,
     10,
     10,
     14,
     8,
     10,
     10,
     30,
     6,
     30,
     0,
     0,
     5,
     0
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": "were faltay but swiched sides"
   }
  ]
 },
 {
  "name": "Oni",
  "kind": "Other",
  "setAside": true,
  "notes": "Set aside for later.",
  "traits": [],
  "movement": [],
  "races": [
   {
    "name": "Oni",
    "size": null,
    "stats": [
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null,
     null
    ],
    "fightingAge": null,
    "lifespan": null,
    "affinity": "",
    "affinity2": "",
    "specialty": "",
    "notes": ""
   }
  ]
 }
];
