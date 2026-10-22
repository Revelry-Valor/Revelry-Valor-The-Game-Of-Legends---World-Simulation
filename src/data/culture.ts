import type { Behaviour, Tradition } from '../core/library';

/**
 * Starting traditions and learned behaviours for the culture creator (REDESIGN.md 8.4e). Each
 * tradition has degrees of severity, mildest first, and the conditions to earn it; behaviours
 * form the culture tree. All editable.
 */
const L = (...pairs: [string, string][]) => pairs.map(([name, description]) => ({ name, description }));
const tr = (id: string, name: string, category: string, description: string, levels: { name: string; description: string }[], conditions: string, o: Partial<Tradition> = {}): Tradition => ({ id, name, category, description, levels, conditions, places: [], beasts: [], effects: '', ...o });
const LAND = 'Land and living';
const OUT = 'Outsiders';
const WAR = 'War';
const WORK = 'Work and trade';
const SOC = 'Society';
const LORE = 'Belief and lore';

export const START_TRADITIONS: Tradition[] = [
  tr('seafaring', 'Seafaring', LAND, 'A people of the sea.', L(['Partial', 'Large fishing fleets and a navy, but also focused on the interior.'], ['Full', 'Most of their livelihood revolves around the sea.']), 'Live by the sea and work it for generations.', { places: ['Sea or lake'], effects: 'Better ships and sailors; sea trade and fishing.' }),
  tr('horse-lords', 'Horse Lords', LAND, 'Born in the saddle.', L(['Riders', 'Horses are central to travel and war.'], ['Horse Lords', 'Life itself is lived on horseback.']), 'Horses (or another mount) and open grassland.', { places: ['Grassland'], beasts: ['horse'], effects: 'Strong cavalry; fast-moving people.' }),
  tr('herders', 'Herders', LAND, 'Wealth is counted in herds.', L(['Herd-keepers', 'Herds alongside farming.'], ['Pastoralists', 'Life follows the herds between seasonal grounds.']), 'Keep herds on open land for generations.', { places: ['Grassland'], effects: 'Better herds; seasonal migration comes naturally.' }),
  tr('hunters', 'Hunters', LAND, 'The hunt feeds and defines them.', L(['Hunters', 'Skilled hunters.'], ['Hunting people', 'Everything revolves around the hunt.']), 'Live mainly by hunting.', { effects: 'More from hunting grounds; skilled scouts.' }),
  tr('tillers', 'Tillers of the soil', LAND, 'Bound to the land they farm.', L(['Farmers', 'Farming is the heart of life.'], ['Rooted', 'Land is sacred; leaving it is unthinkable.']), 'Farm the same land for generations.', { effects: 'Better farms; reluctant to move.' }),
  tr('highlanders', 'Highlanders', LAND, 'At home in the mountains.', L(['Hill folk', 'Comfortable in rough country.'], ['Highlanders', 'Mountain born and bred.']), 'Live in hills or mountains.', { places: ['Hills', 'Mountains'], effects: 'Move and fight well in mountains.' }),
  tr('woodland', 'Forest folk', LAND, 'The forest provides.', L(['Woodlanders', 'Live from the forest.'], ['Forest-bound', 'Never far from the trees.']), 'Live in forest.', { places: ['Forest'], effects: 'Move and fight well in forest; forest goods.' }),
  tr('desert-wanderers', 'Desert wanderers', LAND, 'Masters of dry country.', L(['Desert-wise', 'Know the wells and the routes.'], ['Sand-born', 'The desert is home.']), 'Live in desert or dry steppe.', { places: ['Desert'], effects: 'Cross deserts; find water.' }),
  tr('river-folk', 'River folk', LAND, 'The river is the road and the larder.', L(['River dwellers', 'Life clings to the river.']), 'Live along rivers.', { places: ['Rivers'], effects: 'River trade and fishing.' }),
  tr('deep-delvers', 'Deep delvers', LAND, 'They live and travel underground.', L(['Tunnelers', 'Tunnels as roads.'], ['Deep delvers', 'Underground is home.']), 'Dig and live in tunnels.', { places: ['Underdark', 'Mountains'], effects: 'Tunnel travel; mining.' }),
  tr('canopy-folk', 'Canopy folk', LAND, 'Life among the giant trees.', L(['Tree dwellers', 'Homes in the trees.'], ['Canopy-born', 'Rarely touch the ground.']), 'Live in giant trees.', { places: ['Giant trees'], effects: 'Tree settlements; canopy travel.' }),
  tr('xenophobia', 'Xenophobia', OUT, 'Dealing with other races.', L(['Wary', 'Distrustful of other races.'], ['Hostile', 'Other races are not welcome near.'], ['Fierce', 'Fiercely against other races anywhere near; the core is fiercer than the borders.']), 'Hard history with other races; isolation.', { effects: 'Lower acceptance of other cultures; more conflict.' }),
  tr('hospitality', 'Hospitality', OUT, 'Guests are sacred.', L(['Welcoming', 'Strangers are fed and housed.'], ['Sacred guest-right', 'Harming a guest is the worst crime.']), 'Long trade and travel through their lands.', { effects: 'Higher acceptance; travellers and trade come.' }),
  tr('isolationism', 'Isolationism', OUT, 'Keeps to itself.', L(['Reserved', 'Little contact sought.'], ['Closed', 'Borders and minds are shut.']), 'Isolation behind mountains, sea or forest.', { effects: 'Slow to take on others’ ways.' }),
  tr('martial', 'Warrior culture', WAR, 'War is honour.', L(['Martial', 'Fighting skill is respected.'], ['Warrior people', 'Every adult a warrior.'], ['War-driven', 'Glory only in battle.']), 'Long, frequent war.', { effects: 'Stronger troops; quicker to war.' }),
  tr('raiders', 'Raiders', WAR, 'Wealth is taken.', L(['Raiders', 'Raiding is a way of life.']), 'Poor land beside rich neighbours; fast travel (sea or horse).', { effects: 'Raids; mobile warbands.' }),
  tr('honour-code', 'Honour code', SOC, 'A strict code of conduct.', L(['Honourable', 'Word and oath matter.'], ['Bound by honour', 'Death before dishonour.']), 'A warrior class or old feudal oaths.', { effects: 'Loyal troops and vassals; stubborn in defeat.' }),
  tr('clan-loyalty', 'Clan loyalty', SOC, 'The clan comes first.', L(['Close kin', 'Family ties run deep.'], ['Clan above all', 'Clan before ruler and law.']), 'Clan or tribal life.', { effects: 'Strong clans; harder to centralize.' }),
  tr('artisans', 'Artisans', WORK, 'Proud of fine work.', L(['Crafters', 'Good craftsmanship.'], ['Master artisans', 'Famed for their work.']), 'Rich materials and long crafting.', { effects: 'Better goods; crafts spread.' }),
  tr('traders', 'Traders', WORK, 'Trade is the lifeblood.', L(['Traders', 'Keen merchants.'], ['Merchant people', 'Everything has a price.']), 'Busy trade routes.', { effects: 'More trade; merchant houses.' }),
  tr('monument-builders', 'Monument builders', WORK, 'Building for the ages.', L(['Builders', 'Proud buildings.'], ['Monumental', 'Great works to outlast them.']), 'Stone, labour and a strong ruler or faith.', { effects: 'Great buildings; prestige.' }),
  tr('frugal', 'Frugal survivors', SOC, 'Nothing is wasted.', L(['Thrifty', 'Careful with food and goods.'], ['Hardship-hardened', 'Can live on almost nothing.']), 'Harsh land and lean times.', { effects: 'Survive famine better.' }),
  tr('lorekeepers', 'Lorekeepers', LORE, 'Knowledge is treasured.', L(['Learned', 'Learning is valued.'], ['Lorekeepers', 'Scholars are honoured above warriors.']), 'Writing or strong oral tradition.', { effects: 'Faster learning; keep knowledge longer.' }),
  tr('oral-tradition', 'Storytellers', LORE, 'History lives in story and song.', L(['Storytellers', 'Long memories kept in tales.']), 'No writing, long shared history.', { effects: 'Keep memories and customs without writing.' }),
  tr('ancestor-reverence', 'Ancestor reverence', LORE, 'The dead guide the living.', L(['Respectful', 'Ancestors are honoured.'], ['Ancestor-led', 'Nothing is done against the ancestors’ ways.']), 'Old lineages, long-settled land.', { effects: 'Stable customs; resist change.' }),
  tr('mystic', 'Mana-touched', LORE, 'Close to mana.', L(['Mana-aware', 'Mana is part of life.'], ['Mana-bound', 'Life gathers round dense mana.']), 'Live near dense mana or ley nodes.', { effects: 'More hero mages; mana tech comes easier.' }),
  tr('rift-wardens', 'Rift wardens', LORE, 'They stand watch on the rifts.', L(['Watchful', 'Rifts are guarded.'], ['Wardens', 'Guarding the rifts is their purpose.']), 'Live near rifts through rift tides.', { places: ['Rift'], effects: 'Hold rifts; rift lore.' }),
  tr('feasting', 'Feasting', SOC, 'Bonds are made at the table.', L(['Feasting', 'Great feasts bind people together.']), 'Plenty of food and strong communities.', { effects: 'Loyalty and alliances from feasts.' }),
  tr('pacifism', 'Peaceful', SOC, 'War is the last resort.', L(['Peaceable', 'Prefer talk to war.'], ['Pacifist', 'Will not take up arms.']), 'Long peace, safe borders.', { effects: 'Fewer wars; weaker armies.' }),
];

const bh = (id: string, name: string, category: string, description: string, requires: string[], needsTech: string[], pushesTech: string[], unlocks: string): Behaviour => ({ id, name, category, description, requires, needsTech, pushesTech, unlocks });
const LAW = 'Law and rule';
const FOOD = 'Land and food';
const TRADE = 'Work and trade';
const BWAR = 'War';
const BUILD = 'Building and travel';
const LORE2 = 'Society and lore';

export const START_BEHAVIOURS: Behaviour[] = [
  bh('oral-law', 'Oral law', LAW, 'Customs remembered and spoken by elders.', [], [], [], 'Elders’ councils'),
  bh('tribal-council', 'Tribal council', LAW, 'Clan heads meet to decide together.', ['oral-law'], [], [], 'Council of elders; chiefdoms'),
  bh('written-law', 'Written law', LAW, 'Laws written down and applied the same way.', ['oral-law'], ['writing'], ['libraries'], 'Written-law governments'),
  bh('land-ownership', 'Land ownership', LAW, 'Land belongs to someone.', ['settling'], [], [], 'Lords holding land'),
  bh('feudal-oaths', 'Feudal oaths', LAW, 'Land given for service and loyalty.', ['land-ownership'], [], [], 'Feudal governments: great lords with vassals'),
  bh('royal-court', 'Royal court', LAW, 'A ruler’s household and officials.', ['tribal-council'], [], ['writing'], 'Kings, emperors, viziers'),
  bh('taxation', 'Tax collection', LAW, 'Regular dues to the ruler.', ['royal-court'], ['counting'], ['coinage'], 'Appointed governors; standing armies'),
  bh('inheritance', 'Inheritance law', LAW, 'Fixed rules for who inherits.', ['land-ownership'], [], [], 'Hereditary succession'),
  bh('settling', 'Village life', FOOD, 'Living in one place year-round.', [], ['agriculture'], ['pottery'], 'Settling down; villages'),
  bh('seasonal-migration', 'Seasonal migration', FOOD, 'Moving between summer and winter grounds.', [], [], ['husbandry'], 'Nomadic and semi-nomadic life'),
  bh('herding-rights', 'Herding rights', FOOD, 'Who may graze where.', ['seasonal-migration'], ['husbandry'], ['breeding'], 'Pastoral clans'),
  bh('granaries', 'Granary customs', FOOD, 'Storing grain against hard years.', ['settling'], ['pottery'], ['preserving'], 'Granaries; surviving famine'),
  bh('irrigation-rights', 'Water rights', FOOD, 'Sharing river water for fields.', ['settling'], ['irrigation'], [], 'Large irrigated farmland'),
  bh('markets', 'Market days', TRADE, 'Regular markets where people trade.', ['settling'], ['barter'], ['coinage'], 'Market towns'),
  bh('coinage-customs', 'Coinage customs', TRADE, 'Trusting coins as payment.', ['markets'], ['coinage'], ['banking'], 'Money economy'),
  bh('guild-charters', 'Guild charters', TRADE, 'Crafts organized into guilds.', ['markets'], ['writing'], ['clockwork'], 'Guilds; guild masters'),
  bh('apprenticeship', 'Apprenticeship', TRADE, 'Masters train apprentices.', [], [], ['iron'], 'Skills passed on faster'),
  bh('trade-fairs', 'Trade fairs', TRADE, 'Great fairs drawing distant merchants.', ['markets'], ['carts'], ['banking'], 'Far trade'),
  bh('warbands', 'Clan warbands', BWAR, 'Every clan brings its fighters.', [], [], [], 'Clan warband armies'),
  bh('levies', 'Military levies', BWAR, 'Farmers called up to fight.', ['land-ownership'], [], [], 'Levy armies'),
  bh('retainers', 'Lords’ retainers', BWAR, 'Lords keep trained warriors.', ['feudal-oaths'], ['bronze-arms'], [], 'Retainer armies (samurai-like)'),
  bh('standing-army', 'Standing army', BWAR, 'Paid soldiers in service all year.', ['taxation'], ['iron-arms'], ['fortification'], 'Standing armies'),
  bh('ship-building', 'Ship-building', BUILD, 'Building ships for the sea.', [], ['sailing'], ['navigation'], 'Fleets and navies'),
  bh('tunnel-building', 'Tunnel-building', BUILD, 'Digging tunnels for homes and roads.', [], ['tunnels'], ['masonry'], 'Underground settlements and travel tunnels'),
  bh('road-building', 'Road-building', BUILD, 'Building and keeping roads.', ['settling'], ['roads'], ['engineering'], 'Better roads; faster orders and trade'),
  bh('tree-settling', 'Tree settling', BUILD, 'Building homes in giant trees.', [], ['tree-building'], ['canopy-farming'], 'Tree settlements'),
  bh('record-keeping', 'Record keeping', LORE2, 'Accounts, histories and lists.', [], ['writing'], ['libraries'], 'Archives; a nation’s tech library'),
  bh('marriage-alliances', 'Marriage alliances', LORE2, 'Ruling families bound by marriage.', ['royal-court'], [], [], 'Royal marriages; claims to thrones'),
  bh('envoys', 'Envoys', LORE2, 'Sending speakers to other peoples.', ['tribal-council'], [], ['writing'], 'Diplomacy, pacts and treaties'),
  bh('schools', 'Schools', LORE2, 'Teaching the young to read and reckon.', ['record-keeping'], ['writing'], ['mathematics'], 'Academies; faster learning'),
];
