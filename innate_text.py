"""Chinese explanatory translations of the pinned Vengeance innate effects.

Names and numeric conditions remain in data/ven-skill-data.json. These are
explanatory translations, not verbatim official Chinese game descriptions.
"""

ELEMENTS = {
    'Phys': '物理', 'Fire': '火炎', 'Ice': '冰结', 'Elec': '电击',
    'Force': '冲击', 'Light': '破魔', 'light': '破魔', 'Dark': '咒杀',
    'Almighty': '万能', 'Recovery': '回复', 'Support': '辅助',
    'HP restore': 'HP', 'MP restore': 'MP', 'Panic': '混乱', 'Charm': '魅惑',
}

# Shared effect families use the source row's attribute and numeric modifier.
TEMPLATES = {
    'ally $2 skill potentials raised to own rank':
        '自身在场时，将己方其他成员低于自身的{e}技能适合度提升至与自身相同。',
    'ally $2 magic may crit':
        '自身在场时，己方全体的{e}属性魔法攻击可以触发会心。',
    'ally $2 skill MP costs x$1':
        '自身在场时，己方全体使用{e}技能的MP消耗变为{p}倍。',
    'ally $2 dmg dealt striking weakness x$1':
        '自身在场时，己方全体以{e}属性攻击命中弱点时，造成的伤害变为{p}倍。',
    'ally $2 dmg dealt by crit x$1':
        '自身在场时，己方全体以{e}属性攻击触发会心时，造成的伤害变为{p}倍。',
    '$2 dmg dealt +$1% x total deployed ally matching skill potential, +0% min':
        '自身的{e}属性伤害按在场己方成员的{e}技能适合度合计值提高；每点提高{p}%，合计为负时不降低伤害。',
    '$2 dmg dealt +$1% x total hits dealt by allies during same turn':
        '同一回合内，己方攻击累计每命中1次，自身造成的{e}属性伤害提高{p}%。',
    '$1% chance to counter with $2 dmg + 30% instakill when resisting or nullifying dmg':
        '以耐性减轻或无效化伤害时，有{p}%概率以{e}属性攻击反击，并附带基础成功率30%的即死效果。',
    'Chance of taking correct action x$1 for allies with $2':
        '自身在场时，处于{e}状态的己方成员正确行动的概率变为{p}倍。',
    '$1% $2 to allies when incapacitated':
        '自身陷入无法战斗状态时，己方全体恢复最大{e}的{p}%。',
    '$1% $2 to allies when receiving -kunda effect once per turn':
        '自身受到能力弱化效果时，己方全体恢复最大{e}的{p}%；每回合限一次。',
}

# Effects with distinct triggers are kept explicit so their conditions cannot
# be lost by generic substitutions. {p} is the decoded source modifier.
EFFECTS = {
    'Blessings Abound': '自身受到能力弱化效果时，己方全体恢复最大HP的{p}%并解除异常状态；每回合限一次。',
    'Kept Waiting': '有持有「最佳好友」的同伴在场时，自身行动后恢复最大HP的{p}%和最大MP的15%。',
    'Servant of God': '受到祸灵技能效果影响的己方成员行动时，恢复其最大MP的{p}%；传递、替换和返回后备不触发。',
    'Price of Prosperity': '己方成员陷入无法战斗状态时，己方全体恢复最大HP的{p}%。',
    'Wisdom Unleashed': '自身使用祸灵技能时，己方全体恢复最大MP的{p}%。',
    'Grace Unto Service': '自身接受同伴施加的能力强化效果时，为施术者恢复最大MP的{p}%。',
    'Moirae Cutter': '克洛托和拉刻西斯同时在场时，己方攻击命中弱点会附带基础成功率{p}%的即死效果。',
    'Crippling Blow': '自身攻击命中弱点或触发会心时，附带基础成功率{p}%的即死效果。',
    'Megalomania': '己方成员消耗蓄力效果进行攻击后，有{p}%概率保留该蓄力效果。',
    'Nation Builder': '自身施加能力强化效果时，有{p}%概率同时解除目标的异常状态。',
    'Healing Hand': '自身为同伴恢复HP时，有{p}%概率同时解除目标的异常状态。',
    'Sacrificial Proxy': '自身受到致命攻击时，有{p}%概率牺牲一名后备同伴，以全满HP存活。',
    'Seven-Headed Beast': '本回合召唤过同伴时，回合结束有{p}%概率为己方全体恢复最大MP的10%。',
    'Spirited Synergy': '处于吸引敌方注意状态的己方成员受到致命攻击时，有{p}%概率以1点HP存活。',
    'Summer Dream': '主人公受到致命攻击时，有{p}%概率牺牲一名后备同伴，使主人公以全满HP存活。',
    'Nation Founder': '自身使用回复技能时，有{p}%概率同时施加一种随机能力强化效果。',
    'Honey Trap': '自身防御时，有{p}%概率以物理属性攻击反击，并附带基础成功率30%的即死效果。',
    'Adversary': '自身成为异常状态技能的目标时，有{p}%概率以万能属性攻击反击。',
    'Vinyl Bomb': '自身受到贯穿伤害时，有{p}%概率以相当于所受伤害的万能属性伤害反击。',
    'Allure': '恶魔对话中，有{p}%概率减少对方索要的道具数量，或使索要的魔货减半；每次对话限一次。',
    'Tablet of Destinies': '有{p}%概率使受到的物理属性伤害无效，但受到命中弱点的攻击时无法回避。',
    'Demonic Mediation': '恶魔对话中，有{p}%概率安抚发怒的恶魔；每次对话限一次。',
    'Yumi Nagashi': '自身一次行动消耗2个或更多行动图标时，己方下一回合增加{p}个行动图标。',
    'Hammer of Judgment': '自身受到非固有技能施加的能力弱化效果时，己方下一回合增加{p}个行动图标。',
    'Firmament Restoration': '自身以耐性减轻或无效化伤害达到2次以上时，己方下一回合增加{p}个行动图标。',
    'Scarlet Blade': '自身占用的状态效果与异常状态栏位越多，会心率和会心伤害越高；每个栏位使会心率提高{p}%、会心伤害提高10%。',
    'Four Oni': '在场每有一名持有「四鬼」的己方成员，自身的会心伤害提高{p}%，蓄力效果下的伤害提高12%。',
    'Avenger': '后备中每有一名无法战斗的同伴或同行者，自身造成的伤害提高{p}%。',
    "Hand You're Dealt": '自身与在场同伴的弱点总数越多，自身的会心率越高；每个弱点提高{p}%。',
    'Vengeful Might': '自身与在场同伴的弱点总数越多，自身的会心伤害越高；每个弱点提高{p}%。',
    'Elephantine Ricochet': '自身每有一个弱点，反弹伤害提高{p}%。',
    'Shining Dragon Scales': '同一回合内，己方攻击累计每命中1次，受到祸灵技能效果影响的己方成员造成的伤害提高{p}%。',
    'Herkeios': '后备中每有一名能够战斗的同伴或同行者，自身电击属性攻击的命中率提高{p}%、会心率提高5%。',
    'Speed Star': '攻击速低于自身的敌人时，自身的魔法攻击可以触发会心。',
    "Usurper's Ambition": '己方或敌方有魔王或龙王在场时，自身的魔法攻击可以触发会心。',
    'Focused Assault': '自身与前一名行动同伴攻击同一个敌方单体时，命中率变为{p}倍，会心率变为1.6倍。',
    "Dragon's Blood": '己方有邪龙、龙神或龙王在场时，自身命中率变为{p}倍，会心率变为2倍。',
    'Capricious Goddess': '同一回合内己方已行动8次后，自身造成的伤害变为{p}倍；传递不计入行动次数。',
    'Figment of Darkness': '自身陷入无法战斗状态时，使己方全体的攻击力、防御力、命中率与回避率强化至最高阶；每场战斗限一次。',
    'Righteous Cross': '己方成员陷入无法战斗状态时，使敌方全体的攻击力、防御力、命中率与回避率弱化至最低阶；每场战斗限一次。',
    'Oath of Plenteousness': '自身的攻击力、防御力、命中率与回避率均处于至少1阶强化时，回复技能的HP与MP恢复量变为{p}倍。',
    'Purging Blade': '己方或敌方有堕天使在场时，自身攻击命中弱点造成的伤害变为{p}倍。',
    'Nine-Day Restoration': '祸灵量表未满时，自身攻击命中弱点造成的伤害变为{p}倍。',
    'Paw-to-Paw Combat': '有另一名持有「喵2拳」的同伴在场时，自身造成的伤害变为{p}倍。',
    'Lightning Speed': '自身命中率与回避率处于至少1阶强化时，会心率变为{p}倍。',
    'Might of Dawn': '自身受到贯穿伤害时，必定以附带贯穿效果的破魔属性攻击反击，并附加基础成功率{p}%的幻惑效果。',
    'Magic Harp': '自身受到祸灵技能效果影响，且所用技能的适合度为正时，攻击附带基础成功率35%的睡眠和{p}%的即死效果。',
    'Auspicious Beast': '在场持有「七宿连星神」的己方成员共享各类技能适合度；每一类均采用这些成员中的最高值。',
    'Four Heavenly Kings': '自身被召唤时，若另有持有「四天王」的同伴在场，自身的攻击力、防御力、命中率与回避率各提升{p}阶。',
    'Best Friend': '有持有「傻傻等待」的同伴在场时，自身施加的能力弱化阶数加倍。',
    'Biondetta': '己方没有大天使、女神、鬼女或地母神在场时，自身施加的能力弱化阶数加倍。',
    'Qadistu Cohort': '自身及女魔同伴攻击处于异常状态的敌人时，获得贯穿效果。',
    'Qadistu Artifice': '己方女魔的魔法攻击可以触发会心。',
    'Qadistu Mandate': '己方女魔受到的伤害变为{p}倍。',
    'Qadistu Savagery': '己方女魔的会心率变为{p}倍。',
    'Qadistu Deception': '己方女魔的命中率变为{p}倍，针对她们的攻击命中率变为0.92倍。',
    'Magatsuhi Thriftiness': '使用祸灵技能后，恢复祸灵量表的8%～{p}%。',
    'Pernicious Venom': '己方全体攻击处于异常状态的敌人时，魔法攻击可以触发会心。',
    'Compounded Calamity': '己方全体攻击处于异常状态的敌人并命中弱点时，造成的伤害变为{p}倍。',
    'Burden of Talent': '己方全体攻击命中弱点造成的伤害变为{p}倍，但陷入异常状态的概率变为1.4倍。',
    'Trickery': '提高己方固有技能的触发概率；倍率为{p}乘以在场持有「诡计多端」的己方成员数量。',
    'Divine Decree': '己方全体使用适合度为正的魔法攻击技能时，可以触发会心。',
    'Thesmophoria': '己方地母神、女神或鬼女的魔法攻击可以触发会心。',
    'Chanchala': '攻击力处于2阶强化的己方成员，其魔法攻击可以触发会心。',
    'Ward Off Evil': '己方全体从异常状态自然恢复的概率变为{p}倍。',
    'Dawn of Demise': '己方全体的会心率变为{p}倍，普通攻击附带贯穿效果。',
    'One-Foot Hop': '处于吸引敌方注意状态的己方成员受到的伤害变为{p}倍，针对其攻击的命中率变为0.9倍。',
    'Moirae Spinner': '拉刻西斯和阿特洛波斯同时在场时，己方全体技能的MP消耗变为{p}倍。',
    'Ailed Resurgence': '处于异常状态的己方成员造成的伤害变为{p}倍。',
    'Divined Fortune': '命中率与回避率处于2阶强化的己方成员，会心率变为{p}倍。',
    'Tripura Samhara': '处于蓄力效果下的己方成员，技能的MP消耗变为{p}倍。',
    "Okuninushi's Teachings": '己方有国津神在场时，己方全体使用回复与辅助技能的MP消耗变为{p}倍。',
    'Deathly Affliction': '己方全体攻击处于异常状态的敌人时，命中率变为1.5倍，会心率变为{p}倍。',
    'Bountiful Earth': '防御力处于2阶强化的己方成员，受到未命中弱点的伤害变为{p}倍。',
    'Unending Nightmare': '自身的攻击不会解除目标的睡眠状态。',
    'Warrior Trainer': '有持有「代理猛犬」的同伴在场时，自身使用适合度为正的攻击技能不会落空。',
    'Planck of Norn': '自身主动返回后备时，不消耗行动图标。',
    "Fairy King's Melody": '自身被召唤时，解除己方全体的能力弱化效果。',
    'Rallying Aid': '自身被召唤时，己方全体的攻击力、防御力、命中率与回避率各提升1阶；每场战斗限一次。',
    'Brewing Storm': '自身替换下场时，为替换上场的同伴施加「会心的霸气」。',
    'Eye of Horus': '自身替换下场时，为替换上场的同伴施加「贯穿的斗气」。',
    'Eye of Ra': '自身替换下场时，为替换上场的同伴施加「专心致志」。',
    'Runes of Wisdom': '自身替换下场时，为替换上场的同伴施加「蓄力」。',
    'Myopic Pressure': '自身被召唤时，敌我双方除自身以外的成员，命中率与回避率降低1阶。',
    'Power Menace': '自身被召唤时，敌我双方除自身以外的成员，攻击力降低1阶。',
    'Wanton Rebel': '自身被召唤时，敌我双方除自身以外的成员，防御力降低1阶。',
    'Trumpets of Judgment': '自身被召唤时，解除敌我双方全体的能力强化与弱化效果。',
    'Fickle Personality': '自身受到祸灵技能效果影响，且所用技能的适合度为正时，命中弱点的攻击必定会心。',
    'Fear of Death': '自身受到祸灵技能效果影响，且所用技能的适合度为正时，造成的伤害变为1.1倍，并附带基础成功率{p}%的即死效果。',
    'Moirae Measurer': '克洛托和阿特洛波斯同时在场时，己方施加的能力强化与弱化效果不再因回合经过而到期。',
    'Crime and Punishment': '自身每受到一次命中弱点或会心的攻击，己方下一回合增加{p}个闪烁的行动图标。',
    'Pandemonic Feast': '受到祸灵技能效果影响的己方成员，多段攻击的命中率变为{p}倍，最大攻击次数增加2次。',
    'Faithful Companion': '下一名行动同伴攻击命中弱点时，造成的伤害变为{p}倍。',
    'Helmsman': '下一名行动同伴的命中率变为{p}倍，在幻惑状态下正确选中目标的概率变为1.36倍。',
    'Impenetrable Purity': '自身防御力处于2阶强化并进行防御时，使敌方攻击的贯穿效果无效。',
    'Divine Dismantlement': '己方成员陷入无法战斗状态时，将其当前的能力强化与弱化阶数覆盖到其余同伴身上。',
    'Affable Hospitality': '同伴被召唤至其他位置时，将自身当前的能力强化与弱化阶数覆盖到该同伴身上。',
    'Angelic Order': '自身行动时，按在场持有「大天使的号令」的己方成员数量增加祸灵量表，每名增加{p}%；传递、替换和返回后备不触发。',
    'Heavenly Reversal': '自身被召唤时，将己方全体的能力强化与弱化效果反转，但不延长原本的持续时间。',
    'Surrogate Guard Hound': '自身及己方的神兽、圣兽、魔兽和妖兽，会心伤害变为{p}倍。',
    'Naga-Loka': '自身及己方的邪龙、龙神和龙王，攻击命中弱点时造成的伤害变为{p}倍。',
    'Flame of 12,000 Angels': '自身及己方的破坏神、天使和大天使，攻击命中弱点时造成的伤害变为{p}倍。',
    'Virus Carrier': '自身受到祸灵技能效果影响时，成功施加异常状态不会消耗行动图标。',
    'Curious Dance': '自身替换下场时，将自身的能力强化与弱化效果转移给替换上场的同伴。',
    'Monstrous Offering': '自身替换下场时，若替换上场的同伴为破坏神或龙王，将自身的全部状态效果转移给该同伴。',
    'Mother of Ploys': '自身替换下场时，若替换上场的同伴为魔神，将自身的全部状态效果转移给该同伴。',
    'Skyward Withdrawal': '自身替换下场时，若替换上场的同伴为幻魔，将自身的全部状态效果转移给该同伴。',
    'Four Horsemen': '自身替换下场时，若替换上场的同伴也持有「天启四骑士」，将自身的全部状态效果转移给该同伴。',
    'Taboo': '敌我双方全体的异常状态与即死成功率变为{p}倍，从异常状态自然恢复的概率变为0.8倍。',
    'Forager': '自动贩卖机的道具刷新时间缩短至{p}倍；效果受在场持有「流浪者」的己方成员数量影响。',
}


def explain_innate(row):
    name, element, target = row['a']
    if element != 'inn':
        raise ValueError('Not an innate skill: ' + name)
    effect, condition, _ = row['c']
    modifier = row['b'][7]
    value = (int(modifier) - 1000) / 100 if int(modifier) >= 1000 else modifier
    template = TEMPLATES.get(condition.strip()) or EFFECTS.get(name)
    if template is None:
        raise ValueError('Untranslated innate effect: ' + name)
    text = template.format(e=ELEMENTS.get(effect, effect), p=f'{value:g}')
    return dict(
        effectZh=text,
        targetZh={'All allies': '己方全体', 'Universal': '敌我全体'}.get(target, '依技能条件'),
        categoryZh='固有技能',
        costZh='自动生效／不消耗MP',
        detailZh='',
        translationNote='依固定版本原始效果与游戏中文术语整理，非官方描述逐字转录。',
    )
