"""Chinese explanations of pinned numeric data, using game-localized terminology.
These are explanatory translations, NOT verbatim official description strings.
"""
ELEMENTS={'phy':'物理','fir':'火炎','ice':'冰结','ele':'电击','for':'冲击','lig':'破魔','dar':'咒杀','alm':'万能','ail':'异常状态','rec':'回复','sup':'辅助','pas':'被动','spe':'特殊'}
TARGETS={'-':'自身','Self':'自身','1 foe':'敌方单体','All foes':'敌方全体','Rand foes':'敌方随机目标','1 ally':'己方单体','All allies':'己方全体','1 stock':'一名后备仲魔'}
WORDS={'-':'','Phys':'物理','Fire':'火炎','Ice':'冰结','Elec':'电击','Force':'冲击','Light':'破魔','Dark':'咒杀','Almighty':'万能','Recovery':'回复','St':'力','St-based':'以力为基准','Ma-based':'以魔为基准','magic':'魔法','Charm':'魅惑','Seal':'封技','Panic':'混乱','Poison':'中毒','Sleep':'睡眠','Mirage':'幻惑','ailment':'异常状态','ailments':'异常状态','instakill':'即死','striking weakness':'命中弱点','attack':'攻击力','defense':'防御力','accuracy':'命中率','accuracy + evasion':'命中率与回避率','crit':'会心','crit rate':'会心率','HP restore':'恢复HP','MP restore':'恢复MP','HP and MP restore':'恢复HP与MP','max HP':'最大HP','max MP':'最大MP','exp':'获得经验值','dmg dealt':'造成的伤害','foes':'敌人','Press Turns':'行动图标','-kaja effects':'能力强化效果','-kunda effects':'能力弱化效果','-kaja and -kunda effects':'能力强化与弱化效果','Charge + barrier effects':'蓄力及屏障效果','survives':'存活'}
BUFFS={'Tarukaja':('攻击力',1),'Rakukaja':('防御力',1),'Sukukaja':('命中率与回避率',1),'Tarunda':('攻击力',-1),'Rakunda':('防御力',-1),'Sukunda':('命中率与回避率',-1)}
BASICS={'Pierce':'附带贯穿效果','Patra':'解除异常状态','Dekunda':'解除能力弱化效果','Dekaja':'解除能力强化效果','Taunt':'吸引敌方注意','Phys Block':'使下一次受到的物理属性攻击无效','Luster Candy':'攻击力、防御力、命中率与回避率各提升1阶'}

WORDS.update({'Magatsuhi Gauge':'祸灵量表','-kunda effects on target':'目标身上的能力弱化效果','Press Turn':'行动图标','dmg taken':'受到的伤害','evasion':'回避','max HP + MP':'最大HP与最大MP'})
BASICS.update({'Debilitate':'攻击力、防御力、命中率与回避率各降低1阶','Samarecarm':'使目标复活并恢复全部HP','Summon':'召唤至场上'})

import json
from pathlib import Path
try:
    _TIERS={k:v['tier'] for k,v in json.loads((Path(__file__).resolve().parent/'data'/'skill-tiers.json').read_text(encoding='utf-8')).items() if not k.startswith('_')}
except (OSError,ValueError):
    _TIERS={}
DRAINS={'Life Drain':'HP','Sanguine Drain':'HP','Eat Whole':'HP','Spirit Drain':'MP','Energy Drain':'HP与MP','Meditation':'HP与MP',"Maiden's Morsel":'HP与MP'}
TIERS=('小','中','大','特大','极大')
SINGLE_TIERS=(150,200,250,400)
GROUP_TIERS=(105,150,185,300)
def damage_tier(target,power,minhits,maxhits):
    """Fallback damage tier derived from base power, used only for skills missing from data/skill-tiers.json.
    Anchors: Agi 130 小 / Agilao 160 中 / Agidyne 215 大 / Agibarion 265 特大;
    Maragi 95 小 / Maragion 120 中 / Maragidyne 155 大 / Maragibarion 185 特大."""
    multi=(minhits,maxhits)!=(1,1)
    if multi:
        avg=(minhits+maxhits)/2 if maxhits else 3
        power=power*avg*0.4
    bounds=GROUP_TIERS if target=='All foes' else SINGLE_TIERS
    i=sum(1 for b in bounds if power>=b)
    if multi:i=min(i,3)
    return TIERS[i]

def num(v):return f'{v:g}' if isinstance(v,(float,int)) else str(v)
def word(s):
    if s in WORDS:return WORDS[s]
    if s in BASICS:return BASICS[s]
    if s in BUFFS:
        stat,d=BUFFS[s];return stat+('提升' if d>0 else '降低')+'1阶'
    if ', ' in s:return '、'.join(word(x) for x in s.split(', '))
    if ' + ' in s:return '；'.join(word(x) for x in s.split(' + '))
    raise ValueError('Untranslated effect: '+s)

def repeated(s,count):
    parts=[]
    for token in s.split(' + '):
        if token in BUFFS:
            stat,d=BUFFS[token];direction='提升' if d>0 else '降低'
            parts.append(stat+((direction+'至'+('最高' if d>0 else '最低')+'阶') if count>=4 else direction+num(count)+'阶'))
        else:parts.append(word(token))
    return '；'.join(parts)

SIMPLE_CONDITIONS = {
    'FMTNullElem': '使受到的{e}属性攻击无效',
    'FMTDrainElem': '吸收受到的{e}属性攻击',
    'FMTRepelElem': '反弹受到的{e}属性攻击',
    'FMTResistElem': '受到的{e}属性伤害变为{p}倍',
    'FMTSmtKaja': '{e}提升1阶',
    'FMTSmtKunda': '{e}降低1阶',
    'FMTInstakillWhen': '命中弱点时附加即死判定（基础成功率{p}%）',
    'FMTResistAilment': '陷入{e}的概率变为{p}倍',
    'FMTElemBlock': '使下一次受到的{e}属性攻击无效',
    'FMTElemKarn': '反弹下一次受到的{e}攻击',
    'FMTLifeAidN': '战斗结束后{e}，恢复量为对应最大值的{p}%',
    'FMTEndure': '受到致命攻击时以1点HP存活，每场战斗限一次',
    'FMTEnduringSoul': '受到致命攻击时以全满HP存活，每场战斗限一次',
    'FMTCureAilment': '解除{e}',
    'FMTPowerAgainst': '对处于{e}的敌人，基础威力改为{p}',
    'FMTElemCharge': '下一次{e}的攻击伤害变为{p}倍',
    'FMTRecarm': '使目标复活，恢复最大HP的{p}%',
    'FMTSmtCounterN': '受到{e}攻击时，有{p}%概率以物理攻击反击',
}

def explain(row):
    if row['a'][1] == 'inn':
        from innate_text import explain_innate
        return explain_innate(row)
    name,element,target=row['a'];rank,cost,power,minhits,maxhits,acc,crit,modifier=row['b'];effect,condition,_=row['c']
    m=(int(modifier)-1000)/100 if int(modifier)>=1000 else modifier
    p=num(m);e=word(effect);t=TARGETS[target];parts=[]
    if element=='pas':parts.append('被动生效')
    elif power and element not in ('rec',):
        hits='多次' if maxhits==0 else f'{minhits}～{maxhits}次' if minhits!=maxhits else f'{maxhits}次'
        tier=_TIERS.get(name) or damage_tier(target,power,minhits,maxhits)
        times='' if (minhits,maxhits)==(1,1) else hits
        kind=DRAINS.get(name)
        parts.append(f'对{t}进行{times}{tier}威力的{ELEMENTS[element]}属性'+(f'{kind}吸收攻击' if kind else '攻击'))
    else:parts.append('作用于'+t)
    probability=lambda x:f'附加{x}（基础成功率{p}%，实际受耐性等因素影响）'
    recover_base=f'以基础回复威力计算恢复量，另加最大HP的{p}%'
    if condition=='-':detail=''
    elif condition in SIMPLE_CONDITIONS:detail=SIMPLE_CONDITIONS[condition].format(e=e,p=p)
    elif condition=='FMTBase':detail=e
    elif condition=='FMTExact':detail=probability(e)
    elif condition=='FMTElemBoost':detail=f'{e}'+('技能回复量' if effect=='Recovery' else '属性伤害')+f'变为{p}倍'
    elif condition=='FMTTimes':detail=repeated(effect,m) if any(x in BUFFS for x in effect.split(' + ')) else f'{e}变为{p}倍'
    elif condition=='$1 pwr when $2':detail=f'发生{e}时，基础威力改为{p}'
    elif condition=='$1 pwr when $2, St-based':detail=f'攻击以力为基准；发生{e}时，基础威力改为{p}'
    elif condition=='$2-based':detail=f'攻击以{e}为基准'
    elif condition=='$2-based, Pierce':detail=f'攻击以{e}为基准，附带贯穿效果'
    elif condition=='St-based, $2':detail='攻击以力为基准；'+e
    elif condition=='Draws enemy hostility for 3 turns':detail='在3回合内吸引敌方注意'
    elif condition=='$1 $2 when inflicting ailment':detail=f'成功施加异常状态时{e}{p}点'
    elif condition=='$1 $2 when landing crit or weakness':detail=f'命中弱点或会心时{e}{p}点'
    elif condition=='next attack x$1 + $2':detail=f'下一次攻击伤害变为{p}倍，并{e}'
    elif condition=='Pierce':detail='附带贯穿效果'
    elif condition=='base + $1% max $2':detail=recover_base
    elif condition=='$1% max $2':detail=f'{e}，恢复量为最大HP的{p}%'+('，可超过通常HP上限' if m>100 else '')
    elif condition=='base + $1% max $2, Patra':detail=recover_base+'；解除异常状态'
    elif condition=='base + $1% max $2, Patra + Dekunda':detail=recover_base+'；解除异常状态与能力弱化效果'
    elif condition=='base + $1% max $2, Luster Candy':detail=recover_base+'；攻击力、防御力、命中率与回避率各提升1阶'
    elif condition=='base + $1% max $2, Rakukaja x2':detail=recover_base+'；防御力提升2阶'
    elif condition=='base + $1% max $2, 10 pwr base + 2% max MP restore, Luster Candy':detail=recover_base+'；另外以基础回复威力10加最大MP的2%恢复MP；攻击力、防御力、命中率与回避率各提升1阶'
    elif condition=='Guarantees escape from escapable battles':detail='在允许逃跑的战斗中必定逃跑成功'
    elif condition=='resisted dmg dealt does not consume additional $2':detail='攻击被敌方耐性影响时，不额外消耗行动图标'
    elif condition=='non lvl-dependent dmg dealt x0.9 and $2 dmg dealt x$1':detail=f'非等级依赖型攻击的伤害变为0.9倍，会心伤害变为{p}倍'
    elif condition=='St-based, $1% $2 when striking weakness':detail=f'攻击以力为基准；命中弱点时附加即死判定（基础成功率{p}%）'
    elif condition=='$1% $2 when striking weakness, Pierce':detail=f'附带贯穿效果；命中弱点时附加{e}判定（基础成功率{p}%）'
    elif condition=='$2 +$1%':detail=f'{e}提升{p}%'
    elif condition=='$2 x (1 + curr HP / max HP)':detail='伤害乘以（1＋当前HP／最大HP），HP越高威力越大'
    elif condition in ('extends non-innate $2 cast by $1 turn','extends non-innate $2 cast by $1 turns'):detail=f'自己施放的{e}持续时间延长{p}回合，不适用于固有技能效果'
    elif condition=='base + $1 additional pwr x number of $2':detail=f'基础威力额外增加{p}×'+('目标身上的能力弱化效果数量' if effect=='-kunda effects on target' else '敌人数量')
    elif condition=='$2, Pierce':detail=e+'；附带贯穿效果'
    elif condition=='next $2-based attack will be 100% accurate and guaranteed Critical':detail=f'下一次以{e}为基准的攻击必定命中并发生会心'
    elif condition=='Prevents enemies from fleeing in the field and increases chance of consecutive encounters until the next new moon.':detail='直到下次新月前，场景中的敌人不会逃跑，并提高连续遭遇战的概率'
    elif condition=='$2 x$1, when lower lvl than protag':detail=f'等级低于主人公时，{e}变为{p}倍'
    elif condition=='$1% chance to counter $2 attack with Dark dmg + Tarunda':detail=f'受到{e}的攻击时，有{p}%概率以咒杀属性攻击反击，并降低攻击者1阶攻击力'
    elif condition=='incoming attack acc x$1, counters evaded attack with $2 dmg, Pierce':detail=f'敌方攻击的命中值变为{p}倍；回避攻击后，以附带贯穿效果的{e}攻击反击'
    elif condition=='fills $2 by $1%':detail=f'{e}增加{p}%'
    elif condition=='flashing $2 +$1 next turn when evading attack':detail=f'回避攻击后，下回合增加{p}个闪烁行动图标'
    elif condition=='$2 reduced by $1% for 1 turn':detail=f'在1回合内，{e}降低{p}%'
    elif condition=='base + $1% max $2, Dekunda + Luster Candy':detail=recover_base+'；解除能力弱化效果，攻击力、防御力、命中率与回避率各提升1阶'
    elif condition=='$1% $2 from 1 attack for 1 turn':detail='在1回合内必定回避一次攻击'
    elif condition=='St-based, $1 x user Ag / target Ag hits, 9 hits max':detail=f'攻击以力为基准；攻击次数按{p}×自身速／目标速计算，最多9次'
    elif condition=='base + $1% max $2, does not consume press turn':detail=f'以基础回复威力计算MP恢复量，另加最大MP的{p}%；不消耗行动图标'
    elif condition=='St-based, only usable after evading an attack the previous turn':detail='攻击以力为基准；仅在上一回合回避过攻击后可使用'
    elif condition=='$2 +$1':detail=f'{e}各增加{p}点'
    elif condition=='removes $2':detail=f'解除目标的{e}'
    elif condition=='next $2 spell x2, $1% max HP restore possible for non-overheal skills':detail=f'下一次回复技能的回复量变为2倍；原本不能超量回复的技能也可将HP回复至通常上限的{p}%'
    elif condition.startswith('$1% dmg dealt $2'):
        detail=f'{e}，恢复量为所造成伤害的{p}%'
        if '450 pwr' in condition:detail+='；对陷入异常状态的敌人，基础威力改为450'
        if '350 pwr' in condition:detail+='；对处于魅惑的敌人，基础威力改为350'
        if 'Tarunda' in condition:detail+='；目标攻击力降低1阶'
    elif condition.startswith('$1% $2, '):
        detail=probability(e);extra=condition.split(', ',1)[1]
        extras={'halves foe Press Turns next turn':'敌方下回合的行动图标减半','Tarunda + Rakunda x2':'攻击力与防御力降低2阶','Rakunda + Sukunda':'防御力、命中率与回避率降低1阶','Rakunda':'防御力降低1阶','Tarunda':'攻击力降低1阶','Sukunda x2':'命中率与回避率降低2阶','Dekaja':'解除能力强化效果','270 pwr against foes with ailment':'对陷入异常状态的敌人，基础威力改为270','200% instakill to foes with Charm':'对已处于魅惑的敌人追加即死判定（基础成功率200%）','Pierce':'附带贯穿效果'}
        if extra not in extras:raise ValueError('Untranslated condition suffix '+extra)
        detail+='；'+extras[extra]
    else:raise ValueError('Untranslated condition '+condition)
    if detail:parts.append(detail)
    stats=[]
    if power:stats.append(('基础回复威力' if element=='rec' else '基础威力')+num(power))
    if element!='pas' and crit>5:stats.append('基础会心率'+('必定会心' if crit>=100 else num(crit)+'%'))
    if element!='pas' and power and acc and acc!=255:stats.append('基础命中值'+num(acc))
    return dict(effectZh='；'.join(parts)+'。',targetZh=t,categoryZh=ELEMENTS[element],costZh='被动／不消耗MP' if element=='pas' else f'{cost} MP' if cost<1000 else '消耗祸灵量表',detailZh='；'.join(stats),translationNote='依游戏中文术语整理的数值说明，非官方描述逐字转录。')
