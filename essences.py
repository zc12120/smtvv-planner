"""Essence skill sets, all owned for mixed-route optimization.
Ordinary/Proto/Panagia essence roster cross-checked against the Vengeance item
list. Marici is the later-patch addition. Innate/Magatsuhi/unique skills are NOT
made transferable by owning an essence.
"""
from planner import DEMONS, PLAYABLE, transferable, label
ESSENCES={n:dict(name=n,label=label(n)+'的灵体',skills=[s for s in d['skills'] if transferable(s)])
          for n,d in DEMONS.items() if d['race']!='Human' and n!='Demi-fiend A'}

def candidates(skills,sources):
    """Exact dominance reduction: same-cost superset essence is always as good."""
    bymask={}
    for name,e in ESSENCES.items():
        mask=sum(1<<i for i,s in enumerate(skills) if s in e['skills'] and (s not in sources or sources[s]==name))
        if not mask:continue
        preference=(name not in PLAYABLE,DEMONS[name]['lvl'],name)
        if mask not in bymask or preference<bymask[mask][0]:bymask[mask]=(preference,e)
    return [(mask,item[1]) for mask,item in sorted(bymask.items()) if not any(mask!=other and mask|other==other for other in bymask)]

def essence_catalog():
    """Display the complete essence skill list, with transfer restrictions."""
    from planner import SKILLS
    rows=[]
    for name,e in ESSENCES.items():
        d=DEMONS[name]
        group='aogami' if name.startswith('Aogami ') else 'tsukuyomi' if name.startswith('Tsukuyomi ') else 'demon' if name in PLAYABLE else 'other'
        skills=[]
        for skill in d['skills']:
            if skill not in SKILLS:continue
            can_transfer=transferable(skill)
            skills.append(dict(name=skill,label=label(skill,'skill'),element=SKILLS[skill]['element'],transferable=can_transfer,restriction='' if can_transfer else '创毘专用' if d['race']=='Proto' else '专属／不可转授'))
        rows.append(dict(name=name,label=e['label'],group=group,level=d['lvl'],skills=skills))
    return sorted(rows,key=lambda e:(e['level'],e['name']))
