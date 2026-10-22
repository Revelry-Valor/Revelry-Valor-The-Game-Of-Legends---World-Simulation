import type { Government, Tenet } from '../core/library';

/**
 * The built-in government types the AI uses under certain conditions (REDESIGN.md 8.4b), and the
 * starting tenets for faiths (8.4g). Governments made with the creator are for the cultures you
 * give them to. All editable.
 */
const g = (id: string, name: string, description: string, head: string, ruling: string[], land: string, succession: string, legitimacy: string, army: string[], law: string, conditions: string, needs: string[] = []): Government => ({ id, name, builtIn: true, description, head, ruling, land, succession, legitimacy, army, law, conditions, needs, notes: '' });

export const START_GOVERNMENTS: Government[] = [
  g('clan', 'Clan', 'Kin bound together; a clan holds one or more tribes, and gains more as new tribes form within it.', 'Chief', ['Same as the head'], 'Clans and tribes', 'Elders choose', 'Strength', ['Clan warbands'], 'Custom', 'The start for most peoples: tribes and bands before settling (and for good, for peoples that never settle).', ['oral-law']),
  g('horde', 'Horde', 'Many clans united under one war leader, always on the move.', 'Khan', ['Same as the head'], 'Clans and tribes', 'Hereditary: strongest claimant', 'Strength', ['Clan warbands'], 'Custom', 'Nomadic clans with mounts, united by a strong war leader.', ['tribal-council']),
  g('chiefdom', 'Chiefdom', 'A paramount chief over several villages.', 'Chief', ['Same as the head'], 'Clans and tribes', 'Hereditary: eldest', 'Strength', ['Clan warbands', 'Militia'], 'Custom', 'Settled tribes whose chief holds several villages.', ['tribal-council', 'settling']),
  g('petty-kingdom', 'Petty kingdom', 'A small realm under a king, held by a handful of lords.', 'King or queen', ['Nobility (great lords and lesser nobles)'], 'Great lords with vassals (feudal)', 'Hereditary: eldest', 'True line / sacred blood', ['Levies'], 'Lords’ justice', 'A chiefdom grown large enough to need lords.', ['royal-court', 'land-ownership']),
  g('city-state', 'City-state', 'One great city and the land around it, ruling itself.', 'Assembly', ['Merchant houses'], 'Free cities', 'Election by lords', 'Wealth', ['Militia', 'Mercenaries'], 'Written law', 'A rich city on its own, strong in trade.', ['markets', 'written-law']),
  g('theocracy', 'Theocracy', 'Ruled by the faith and its clergy.', 'High priest', ['Clergy'], 'Temples', 'Chosen by the gods or temple', 'Divine right', ['Religious or magic orders', 'Levies'], 'Religious law', 'A strong clergy faction, high fervour.'),
  g('magocracy', 'Magocracy', 'Ruled by mages.', 'Archmage', ['Mage council'], 'The state directly', 'Merit (such as the strongest mage)', 'Magic power', ['Religious or magic orders', 'Standing army'], 'Magical oaths', 'Dense mana and mage towers.'),
  g('feudal-kingdom', 'Feudal kingdom', 'A king over great lords and their vassals, each holding land for service.', 'King or queen', ['Nobility (great lords and lesser nobles)'], 'Great lords with vassals (feudal)', 'Hereditary: eldest', 'True line / sacred blood', ['Levies', 'Lords’ retainers (samurai-like)'], 'Lords’ justice', 'A large settled realm with land-holding nobles.', ['feudal-oaths']),
  g('empire', 'Empire', 'An emperor over many peoples and lands.', 'Emperor', ['Nobility (great lords and lesser nobles)', 'High princes'], 'Appointed governors', 'Hereditary: any child', 'Divine right', ['Standing army', 'Levies'], 'Written law', 'Many conquered cultures under one ruler.', ['royal-court', 'taxation']),
  g('republic', 'Republic', 'Ruled by elected leaders and an assembly.', 'Elected leader', ['Same as the head'], 'The state directly', 'Election by the people', 'Consent of the people', ['Militia', 'Standing army'], 'Written law', 'Strong towns, written law, no dominant line.', ['written-law']),
  g('merchant-republic', 'Merchant republic', 'Ruled by the great merchant houses.', 'Elected leader', ['Merchant houses'], 'Free cities', 'Election by lords', 'Wealth', ['Mercenaries', 'Militia'], 'Written law', 'Wealthy trading cities.', ['coinage-customs', 'written-law']),
  g('elective-monarchy', 'Elective monarchy', 'A king chosen by the great lords.', 'King or queen', ['Nobility (great lords and lesser nobles)'], 'Great lords with vassals (feudal)', 'Election by lords', 'Consent of the people', ['Levies', 'Lords’ retainers (samurai-like)'], 'Lords’ justice', 'Powerful lords and no settled line.', ['feudal-oaths']),
  g('gerontocracy', 'Gerontocracy', 'Ruled by the eldest.', 'Council of elders', ['Same as the head'], 'Clans and tribes', 'Elders choose', 'Consent of the people', ['Militia'], 'Custom', 'Long-lived peoples, or those who revere their elders.', ['tribal-council']),
];

const t = (id: string, name: string, description: string, levels: [string, string][], effects: string): Tenet => ({ id, name, description, levels: levels.map(([n, d]) => ({ name: n, description: d })), effects });

export const START_TENETS: Tenet[] = [
  t('sanctity-of-nature', 'Sanctity of nature', 'The wild world is holy.', [['Respectful', 'Take only what is needed.'], ['Sacred', 'Clearing forest or killing beasts needlessly is a sin.']], 'Fewer farms carved from forest; protects groves and beasts.'),
  t('holy-war', 'Holy war', 'The faith is spread and defended by the sword.', [['Defenders', 'War to defend the faith is holy.'], ['Crusaders', 'War against unbelievers is a duty.']], 'Holy war as a reason for war; fervour from victories.'),
  t('pacifism', 'Pacifism', 'Violence is wrong.', [['Peaceable', 'War only in defence.'], ['Pacifist', 'Taking life is the gravest sin.']], 'Fewer wars; weaker armies.'),
  t('ancestor-rule', 'Ancestor rule', 'The ancestors still guide the living.', [['Honoured', 'Ancestors are consulted.'], ['Ruling', 'The ancestors’ will is law.']], 'Stable customs; elders hold power.'),
  t('rift-abhorrence', 'Rift abhorrence', 'Rifts are wounds to be closed.', [['Wary', 'Rifts are shunned.'], ['Abhorrent', 'Rifts and those who use them must be fought.']], 'Rift-warden orders; war on rift cults.'),
  t('rift-reverence', 'Rift reverence', 'Rifts are holy openings.', [['Reverent', 'Rifts are holy places.'], ['Devoted', 'Rift tides are divine gifts.']], 'Holy sites at rifts; rift cults.'),
  t('asceticism', 'Asceticism', 'Holiness through going without.', [['Modest', 'Wealth is distrusted.'], ['Ascetic', 'The holy live with nothing.']], 'Less luxury trade; respected clergy.'),
  t('charity', 'Charity', 'The faithful care for the poor.', [['Generous', 'Alms are a duty.']], 'Less unrest in hard times.'),
  t('sacred-hospitality', 'Sacred hospitality', 'Strangers must be welcomed.', [['Welcoming', 'Guests are protected.']], 'Higher acceptance of others.'),
  t('purity', 'Purity', 'Keep the faith and the people pure.', [['Careful', 'Avoid unclean things.'], ['Strict', 'Outsiders and unbelievers are unclean.']], 'Lower acceptance; resists blending.'),
  t('sacred-fire', 'Sacred fire', 'Fire is divine.', [['Keepers', 'Holy flames are tended.']], 'Fire temples; volcanoes as holy sites.'),
  t('sacred-waters', 'Sacred waters', 'Springs, rivers and lakes are holy.', [['Keepers', 'Holy waters are tended.']], 'Holy sites at lakes and springs.'),
  t('world-tree', 'The world tree', 'The world tree and its roots are holy.', [['Reverent', 'Root crossings are holy.'], ['Devoted', 'Harming the roots is the worst sin.']], 'Holy sites at world tree root crossings.'),
  t('mana-sanctity', 'Sanctity of mana', 'Mana is the breath of the gods.', [['Reverent', 'Mana is holy.'], ['Zealous', 'Draining mana is sacrilege.']], 'Temples at ley nodes; mages respected.'),
  t('divine-rulers', 'Divine rulers', 'The ruler is chosen by, or descended from, the gods.', [['Blessed', 'Rulers rule by divine right.'], ['Divine', 'The ruler is a god on earth.']], 'Divine-right legitimacy; theocracies.'),
  t('martyrdom', 'Martyrdom', 'Dying for the faith is glory.', [['Honoured', 'Martyrs are remembered.'], ['Sought', 'Death for the faith is sought.']], 'Fervour from losses; fanatical troops.'),
  t('learning', 'Sacred learning', 'Knowledge is holy.', [['Scholarly', 'Temples keep books.'], ['Devoted', 'Seeking knowledge is worship.']], 'Temple libraries; faster learning.'),
  t('fertility', 'Fertility', 'Many children are a blessing.', [['Blessed', 'Large families honoured.']], 'Faster growth.'),
  t('prophecy', 'Prophecy', 'The future is foretold.', [['Watchful', 'Omens are read.'], ['Fated', 'Prophecy guides every choice.']], 'Prophecies that shape events.'),
  t('trickster-ways', 'The trickster’s way', 'Cunning is a virtue.', [['Clever', 'Wit is admired.']], 'Spies and schemes favoured.'),
];
