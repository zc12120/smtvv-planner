"""Chinese display text; original conditions remain in the source JSON files.
Known localized quest names are used where corroborated. Other quests use a
Chinese description instead of inventing an official title.
"""
import re

TITLES={
'Special Training: Army of Chaos':'特殊战斗训练·混沌军恶魔',
'Special Training: The Kunitsukami':'特殊战斗训练·地祇之恶魔',
'She Who Rules the Night':'司掌月亮的夜之女王',
'The Demon of the Spring':'清净的源泉',
'A Wish for a Fish':'好想吃鱼呀',
'A Goddess Stolen':'被掳走的伊登',
'Reclaim the Golden Stool':'黄金椅子的夺还',
'Liberate the Golden Stool':'黄金椅子的解放',
'The Guardian of Light':'光之护法善神',
"Fionn's Resolve":'芬恩·麦克库尔的决心',
'The Benevolent One':'黄龙将至',
'The Destined Leader':'九天的魔王',
'The Holy Ring':'将戒指放入御樋代',
'The Tyrant of Tennozu':'天王洲的魔王',
'Roar of Hatred':'憎恨的蛮声',
"The Bull God's Lineage":'牛神的系谱',
'The Winged Sun':'有翼太阳争夺战',
'The Succession of Ra':'拉的继承',
'A Universe in Peril':'阻止宇宙被破坏吧',
'A Plot Revealed':'谋略的结局',
'The Compassionate Queen':'大发慈悲的天之女王',
"The Seraph's Return":'天使长归来',
'The Noble Queen':'崇高的天之女王',
'The Wrathful Queen':'勇猛的天之女王',
"The Red Dragon's Invitation":'红龙的诱惑',
'Devotion to Order':'为秩序献身',
'God of Old, Devourer of Kin':'食子之旧神',
'The Serpent King':'蛇神之王',
'The Great Adversary':'伟大的敌对者',
'A Goddess in Training':'女神的修行',
"The Doctor's Last Wish":'博士最初也是最后的请求',
'Return of the True Demon':'人修罗与九位魔人',
'Sakura Cinders of the East':'花焰盛开于东之都',
'Holy Will and Profane Dissent':'神的本质，恶魔的真意',
}
DESCRIPTIONS={
'Supersonic Racing':'与高速婆婆竞速的支线',
'The Angel of Destruction':'讨伐破坏天使的支线',
'The Search for Oyamatsumi':'寻找大山津见的支线',
'Clash with the Kunitsukami':'与国津神交战的支线',
'Wannabee-ho Nahobino':'创毘霜精相关支线',
'Rite of Resurrection':'复活仪式相关支线',
'Guardian of Tokyo':'守护东京、挑战将门的支线',
'The Rage of a Queen':'克利奥帕特拉相关支线',
}

def quest(name):
    if name in TITLES:return '任务「'+TITLES[name]+'」'
    if name in DESCRIPTIONS:return DESCRIPTIONS[name]
    raise ValueError('Untranslated quest: '+name)

CHAOS_TRAINING='创世女神篇：随主线剧情解锁；复仇女神篇：完成任务「特殊战斗训练·混沌军恶魔」后解锁。'
EXACT={
'Story locked':'随主线剧情推进解锁。',
'Story locked (CoV)':'复仇女神篇：随主线剧情推进解锁。',
'Story locked (CoC)':'创世女神篇：随主线剧情推进解锁。',
'Story locked or (CoC) Clear "Special Training: Army of Chaos" (CoV)':CHAOS_TRAINING,
'Story locked (CoC) or Clear "Special Training: Army of Chaos" (CoV)':CHAOS_TRAINING,
'Chaos Route (CoC) or Story locked (CoV)':'创世女神篇：进入混沌路线后解锁；复仇女神篇：随主线剧情推进解锁。',
"New Game+ (CoC) or Follow up on Bethel's investigation of Yakumo (CoV)":'创世女神篇：进入继承通关数据的新周目后解锁；复仇女神篇：继续推进伯特利调查八云的相关事件后解锁。',
'New Game+ (CoC) or Story locked (CoV)':'创世女神篇：进入继承通关数据的新周目后解锁；复仇女神篇：随主线剧情推进解锁。',
'New Game+ (CoV)':'复仇女神篇：进入继承通关数据的新周目后解锁。',
'Godborn New Game+':'以「创生」模式开启新周目后解锁。',
'Fusion Accident':'通过合体事故获得。',
'Clear "The Search for Oyamatsumi" (CoC) or "Special Training: The Kunitsukami" (CoV)':'创世女神篇：完成寻找大山津见的支线后解锁；复仇女神篇：完成任务「特殊战斗训练·地祇之恶魔」后解锁。',
'Clear "Clash with the Kunitsukami" (CoC) or "Special Training: The Kunitsukami" (CoV)':'创世女神篇：完成与国津神交战的支线后解锁；复仇女神篇：完成任务「特殊战斗训练·地祇之恶魔」后解锁。',
'Clear "The Succession of Ra" (CoC) or "Rite of Resurrection" (CoV)':'创世女神篇：完成任务「拉的继承」后解锁；复仇女神篇：完成复活仪式相关支线后解锁。',
}
AREAS={'Minato':'港区','Shinagawa':'品川区','Chiyoda or Shinjuku':'千代田区或新宿区','Taito':'台东区'}
HUSKS={'Shiba Park':'芝公园','Nagatacho':'永田町','Tennozu':'天王洲','Shinagawa Pier':'品川码头','South Shinagawa':'南品川','Shinobazu Pond':'不忍池','Komagata':'驹形','Asakusa':'浅草','Mita':'三田','Tennozu Park':'天王洲公园','Honjo':'本所'}
ROUTE_HUSKS={
'Chiyoda 1 Aogami Husk (CoC) or Shinjuku Gyoen Aogami Husk (CoV)':('千代田（区域1）','新宿御苑'),
'Chiyoda 3 Aogami Husk (CoC) or Kabukicho Aogami Husk (CoV)':('千代田（区域3）','歌舞伎町'),
'Chiyoda 4 Aogami Husk (CoC) or West Shinjuku 3rd Block Aogami Husk (CoV)':('千代田（区域4）','西新宿三丁目'),
'Chiyoda 2 Aogami Husk (CoC) or Yoyogi Aogami Husk (CoV)':('千代田（区域2）','代代木'),
}
RESEARCH={
'Tokyo Diet Building Head Researcher after reaching Shakan: 1st Stratum Foyer (CoV)':'至圣所夏康第一层入口',
'Tokyo Diet Building Head Researcher after reaching Temple of Eternity: 1F Outside (CoV)':'万古神殿一层外侧',
'Tokyo Diet Building Head Researcher after reaching Empyrean: Path to the Throne (CoV)':'至高天通往王座的道路',
}
QUALIFIERS={'CoC':'创世女神篇','CoV':'复仇女神篇','Law alignment':'属性倾向为秩序','Neutral alignment':'属性倾向为中立','Chaos alignment':'属性倾向为混沌','Law Route':'秩序路线','Chaos Route':'混沌路线'}

def translate_condition(text):
    if not text:return ''
    if text in EXACT:return EXACT[text]
    if text in ROUTE_HUSKS:
        a,b=ROUTE_HUSKS[text];return f'创世女神篇：调查{a}的青神遗骸；复仇女神篇：调查{b}的青神遗骸。'
    if text in RESEARCH:return f'复仇女神篇：到达{RESEARCH[text]}后，向东京国会议事堂的研究负责人领取。'
    if text.endswith(' Aogami Husk'):
        return '调查'+HUSKS[text.removesuffix(' Aogami Husk')]+'的青神遗骸获得。'
    if text.startswith('Defeat in '):return '在'+AREAS[text.removeprefix('Defeat in ')]+'击败该魔人后解锁。'
    if text.startswith('Clear '):
        names=re.findall(r'"([^"]+)"',text)
        qualifiers=re.findall(r'\(([^)]+)\)',text)
        if not names:raise ValueError('Missing quest name')
        prefix='、'.join(QUALIFIERS[q] for q in qualifiers)
        return (prefix+'：' if prefix else '')+'完成'+'或'.join(quest(n) for n in names)+'后解锁。'
    raise ValueError('Untranslated condition: '+text)
