"""Pinned SMT V Vengeance rules and deterministic skill-provenance planner."""
import json
import re
import time
from collections import defaultdict, deque, Counter
from functools import lru_cache
from pathlib import Path
from skill_text import explain
from unlock_text import translate_condition

from game_data import (ROOT, VERSION, COMMIT, read, DEMONS, SPECIAL, PREREQS, CHART,
                       ELEMENT, SKILLS, UNLOCKS, DLC, PLAYABLE, ACCIDENTS, RAW_UNLOCKS,
                       RAW_PREREQS, RACES, LABELS, INNATE, DEMON_PROFILES, load_profiles,
                       label, transferable, string_list)

def innate_skill(name):
    return dict(name=name,label=label(name,'skill'),element='innate',unique=True,
                restriction='固有技能／不可继承或通过灵体转授',**explain(SKILLS[name]['raw']))

def catalog():
    demons = [dict(name=n, label=label(n), level=d['lvl'], race=d['race'], raceLabel=label(d['race'],'race'), skills=d['skills'], stats=d['stats'], resists=d['resists'], affinities=d['affinities'], innate=label(INNATE.get(n,'-'),'skill'), unlock=UNLOCKS.get(n, PREREQS.get(n,'')), dlc=n in DLC, special=SPECIAL.get(n,[]), accident=n in ACCIDENTS) for n,d in PLAYABLE.items()]
    learned = {s for d in PLAYABLE.values() for s in d['skills']}
    skills = [s | explain(s['raw']) | {'label':label(n,'skill'),'unique':not transferable(n),'sources':[dict(name=d,level=max(PLAYABLE[d]['lvl'],int(PLAYABLE[d]['skills'][n]))) for d in PLAYABLE if n in PLAYABLE[d]['skills']]} for n,s in SKILLS.items() if n in learned]
    from essences import essence_catalog
    prices=read('comp-costs')
    for d in demons:
        d['basePrice']=prices[d['name']]*2
        d['innateId']=INNATE.get(d['name'])
        profile=DEMON_PROFILES.get('demons',{}).get(d['name'],{})
        d['descriptionZh']='\n\n'.join(profile.get('paragraphs',[]))
        d['descriptionSource']=DEMON_PROFILES['source'].get('label','') if profile else ''
        d['ailments']=PLAYABLE[d['name']].get('ailments','------')
    innates=[innate_skill(n) for n in sorted({INNATE[n] for n in PLAYABLE})]
    from compute_protocol import revision
    return dict(demons=sorted(demons,key=lambda d:(d['level'],d['name'])),skills=sorted(skills,key=lambda s:s['name']),innateSkills=innates,essences=essence_catalog(),demonProfileSource=DEMON_PROFILES['source'],source=COMMIT,version=revision())

class FusionGraph:
    def __init__(self, dlc=False, locked=()):
        enabled = DLC if dlc is True else set(dlc or ())
        self.demons = {n:d for n,d in PLAYABLE.items() if (n not in DLC or n in enabled) and n not in locked}
        self.by_race = defaultdict(list)
        for n,d in self.demons.items():
            if n not in SPECIAL and n not in ACCIDENTS: self.by_race[d['race']].append(n)
        for names in self.by_race.values(): names.sort(key=lambda n:self.demons[n]['lvl'])
        self.pair_special = {frozenset(v):n for n,v in SPECIAL.items() if len(v)==2 and n in self.demons}
        self.recipes, self.edges, self.reverse, self.uncertain = [],defaultdict(list),defaultdict(list),{}
        names=list(self.demons)
        for i,a in enumerate(names):
            for b in names[i+1:]:
                result,reason=self.calculate(a,b)
                if result:
                    self.add(result,(a,b))
                    if reason: self.uncertain[(result,tuple(sorted((a,b))))]=reason
        for result,ingredients in SPECIAL.items():
            if len(ingredients)>2 and result in self.demons and all(n in self.demons for n in ingredients): self.add(result,tuple(ingredients))

    def add(self,result,ingredients):
        recipe=(result,ingredients);self.recipes.append(recipe);self.reverse[result].append(ingredients)
        for n in ingredients:self.edges[n].append(recipe)

    def calculate(self,a,b):
        if a==b or a not in self.demons or b not in self.demons:return None,''
        pair=self.pair_special.get(frozenset((a,b)))
        if pair:return pair,''
        da,db=self.demons[a],self.demons[b];ra,rb=da['race'],db['race']
        if ra=='Element' or rb=='Element':
            if ra==rb:return None,''
            elem,name=(a,b) if ra=='Element' else (b,a)
            d=self.demons[name]
            if d['race'] not in ELEMENT['races'] or elem not in ELEMENT['elems']:return None,''
            offset=ELEMENT['table'][ELEMENT['races'].index(d['race'])][ELEMENT['elems'].index(elem)]
            candidates=self.by_race[d['race']]
            if not offset or not candidates:return None,''
            # Use the same rank ordering regardless of which material was selected first.
            names=sorted(set(candidates+[name]),key=lambda n:self.demons[n]['lvl'])
            index=names.index(name)+offset
            reason='特殊仲魔参与精灵合体：按等级插入并跳过特殊结果，仍待游戏实测。' if name in SPECIAL else ''
            if index>=len(names) and offset>0:
                result=candidates[0]
                if result==name:return None,''
                return result,'最高阶精灵升阶循环：多份攻略支持，仍待游戏实测。'
            if index<0 or index>=len(names):return None,''
            return names[index],reason
        i,j=sorted((RACES[ra],RACES[rb]),reverse=True);race=CHART['table'][i][j]
        if race=='-':return None,''
        if race in ELEMENT['elems']:return (race,'') if race in self.demons else (None,'')
        candidates=self.by_race[race]
        if not candidates:return None,''
        threshold=(da['lvl']+db['lvl'])/2+1
        index=next((i for i,n in enumerate(candidates) if self.demons[n]['lvl']>=threshold),len(candidates)-1)
        result=candidates[index]
        if result in (a,b) and index+1<len(candidates):result=candidates[index+1]
        return result,''

    def fuse(self,a,b):return self.calculate(a,b)[0]
    def reason(self,result,ingredients):return self.uncertain.get((result,tuple(sorted(ingredients))), '')

@lru_cache(maxsize=12)
def cached_graph(dlc,locked):return FusionGraph(dlc,locked)

def settings(request):
    from configuration import Settings
    config = Settings.parse(request)
    return (cached_graph(config.dlc, config.locked), config.level, config.slots,
            set(config.excluded), config.allow_uncertain)

def inspect_fusion(request):
    graph,*_=settings(request)
    materials=string_list(request.get('materials',[]),'合体材料',PLAYABLE)
    if not 2<=len(materials)<=4:raise ValueError('请选择 2–4 只不同仲魔。')
    if any(n not in graph.demons for n in materials):raise ValueError('材料受到 DLC 或未解锁设置限制。')
    if len(materials)==2:result,reason=graph.calculate(*materials)
    else:
        result=next((n for n,ins in SPECIAL.items() if n in graph.demons and sorted(ins)==sorted(materials)),None);reason=''
    return dict(result=result,reason=reason,materials=materials,special=result in SPECIAL if result else False,unlock=UNLOCKS.get(result,''),level=PLAYABLE[result]['lvl'] if result else None)

def reverse_recipes(request):
    graph,level,slots,excluded,uncertain=settings(request);target=request.get('target')
    if target not in graph.demons:raise ValueError('目标不可用。')
    recipes=[dict(materials=list(ins),reason=graph.reason(target,ins),maxLevel=max(graph.demons[n]['lvl'] for n in ins)) for ins in graph.reverse[target] if all(n not in excluded for n in ins)]
    recipes.sort(key=lambda r:(bool(r['reason']),r['maxLevel'],r['materials']))
    return dict(target=target,recipes=recipes,accident=target in ACCIDENTS)

def plan(request):
    from configuration import parse_config
    config = parse_config(request, 'plan')
    target = config['target']
    selected = string_list(request.get('skills', []), '技能', SKILLS)
    graph, level, slots, excluded, uncertain = settings(config)
    allowed = {n for n, d in graph.demons.items() if n not in excluded and d['lvl'] <= level}
    sources = config['sources']
    skills=[s for s in selected if transferable(s)];full=(1<<len(skills))-1
    def names(mask):return [s for i,s in enumerate(skills) if mask&(1<<i)]
    native={n:sum(1<<i for i,s in enumerate(skills) if s in graph.demons[n]['skills'] and graph.demons[n]['skills'][s]<=level and (s not in sources or sources[s]==n)) for n in allowed}
    unique=[s for s in selected if not transferable(s)]
    if any(graph.demons[target]['skills'][s]>level for s in unique):raise ValueError('等级上限不足以学会目标专属技能。')
    # Pre-filter recipe edges; search states preserve skill provenance.
    edges=defaultdict(list)
    for result,ingredients in graph.recipes:
        if result not in allowed or any(n not in allowed for n in ingredients):continue
        if not uncertain and graph.reason(result,ingredients):continue
        extra=native[result]
        for n in ingredients:extra|=native[n]
        for n in ingredients:edges[n].append((result,ingredients,extra))
    queue=deque();previous={}
    for n in sorted(allowed,key=lambda n:(graph.demons[n]['lvl'],n)):
        state=(n,native[n]);previous[state]=None;queue.append(state)
    goal=(target,full);started=time.monotonic()
    while goal not in previous and queue:
        if time.monotonic()-started>15:return dict(found=False,message='已达到 15 秒搜索上限，尚未找到路线；不代表游戏中无解。')
        state=queue.popleft();n,mask=state
        for result,ingredients,extra in edges[n]:
            nxt=(result,mask|extra)
            if nxt in previous:continue
            previous[nxt]=(state,ingredients);queue.append(nxt)
            if nxt==goal:break
    if goal not in previous:return dict(found=False,message='当前搜索范围内未找到路线。可调整技能来源、等级、解锁设置，或允许待核实配方；这不代表游戏中无解。')
    chain=[];state=goal
    while previous[state] is not None:
        parent,ingredients=previous[state];chain.append((state,parent,ingredients));state=parent
    chain.reverse();leaves=[];steps=[];serial=0
    def leaf(n,needed):
        nonlocal serial
        serial+=1
        entry=dict(id='m'+str(serial),name=n,level=max([graph.demons[n]['lvl']]+[int(graph.demons[n]['skills'][s]) for s in needed]),learn=needed,unlock=UNLOCKS.get(n,PREREQS.get(n,'')))
        leaves.append(entry);return entry['id']
    carrier_id=leaf(state[0],names(state[1])+ (unique if not chain else []))
    for number,(state,parent,ingredients) in enumerate(chain,1):
        result,mask=state;ids=[];inherited_mask=parent[1]
        for n in ingredients:
            ids.append(carrier_id if n==parent[0] else leaf(n,names(native[n])))
            inherited_mask|=native[n]
        inherited=names(inherited_mask);natural=[s for s in names(native[result]) if s not in inherited]
        if number==len(chain):natural+=unique
        carrier_id='s'+str(number)
        steps.append(dict(id=carrier_id,number=number,result=result,ingredients=list(ingredients),materialIds=ids,carrier=parent[0],inherit=inherited,learn=natural,keep=names(mask)+(unique if number==len(chain) else []),level=max([graph.demons[result]['lvl']]+[int(graph.demons[result]['skills'][s]) for s in natural]),special=result in SPECIAL,unlock=UNLOCKS.get(result,''),reason=graph.reason(result,ingredients)))
    conditions={n:UNLOCKS.get(n,PREREQS.get(n,'')) for n in {x['name'] for x in leaves}|{x['result'] for x in steps}}
    response=dict(found=True,target=target,skills=selected,materials=leaves,steps=steps,finalId=carrier_id,conditions={n:c for n,c in conditions.items() if c},explored=len(previous),seconds=round(time.monotonic()-started,3),ownSkills=unique,finalLevel=max([PLAYABLE[target]['lvl']]+[int(PLAYABLE[target]['skills'][s]) for s in unique]),version=VERSION)
    validate_route(response,graph,selected,sources,level,slots,excluded,uncertain)
    response['validated']=True
    return annotate_skill_sources(response)

def annotate_skill_sources(route):
    """Attach actual immediate carriers and original learners to every skill."""
    known={}
    def learned(n,mid,skill):
        raw=PLAYABLE[n]['skills'][skill]
        return dict(name=n,id=mid,level=max(PLAYABLE[n]['lvl'],int(raw)),initial=raw<1)
    for material in route['materials']:
        known[material['id']]={s:[learned(material['name'],material['id'],s)] for s in material['learn']}
    for step in route['steps']:
        carriers={};inherited={}
        for skill in step['inherit']:
            carriers[skill]=[];origins={}
            for mid,name in zip(step['materialIds'],step['ingredients']):
                if skill in known[mid]:
                    carriers[skill].append(dict(name=name,id=mid))
                    for origin in known[mid][skill]:origins[origin['id']]=origin
            inherited[skill]=list(origins.values())
        step['inheritSources']=carriers
        step['learnSources']={s:learned(step['result'],step['id'],s) for s in step['learn']}
        for skill,origin in step['learnSources'].items():inherited.setdefault(skill,[]).append(origin)
        known[step['id']]=inherited
    route['skillSources']={s:known[route['finalId']][s] for s in route['skills']}
    return route

def validate_route(route,graph,selected,sources,level,slots,excluded,allow_uncertain):
    """Replay a plan using instance IDs, consuming materials and tracking origins."""
    available={}
    def fail():raise ValueError('路线校验失败，已停止输出。')
    for m in route['materials']:
        n=m['name']
        if n not in graph.demons or n in excluded or m['level']>level or m['level']<graph.demons[n]['lvl']:fail()
        origins={}
        for s in m['learn']:
            if s not in graph.demons[n]['skills'] or graph.demons[n]['skills'][s]>m['level']:fail()
            origins[s]={n}
        available[m['id']]=(n,origins)
    for step in route['steps']:
        result=step['result'];origins={}
        if result in excluded or result not in graph.demons or step['level']>level or step['level']<graph.demons[result]['lvl']:fail()
        if len(step['ingredients'])==2:
            if graph.calculate(*step['ingredients'])[0]!=result:fail()
        elif sorted(SPECIAL.get(result,[]))!=sorted(step['ingredients']):fail()
        if graph.reason(result,step['ingredients']) and not allow_uncertain:fail()
        if len(step['materialIds'])!=len(step['ingredients']):fail()
        for mid,n in zip(step['materialIds'],step['ingredients']):
            if mid not in available:fail()
            actual,known=available.pop(mid)
            if actual!=n:fail()
            for s,where in known.items():origins.setdefault(s,set()).update(where)
        inherited={}
        for s in step['inherit']:
            if not transferable(s) or s not in origins:fail()
            inherited[s]=origins[s]
        for s in step['learn']:
            if s not in graph.demons[result]['skills'] or graph.demons[result]['skills'][s]>step['level']:fail()
            inherited.setdefault(s,set()).add(result)
        if len(inherited)>slots or set(step['keep'])!=set(inherited):fail()
        available[step['id']]=(result,inherited)
    if route['finalId'] not in available:fail()
    n,known=available[route['finalId']]
    if n!=route['target'] or not set(selected)<=set(known):fail()
    for s,n in sources.items():
        if n not in known.get(s,set()):fail()


def skill_detail(name):
    if not isinstance(name,str) or name not in SKILLS:raise ValueError('没有找到该技能。')
    if SKILLS[name]['element'] == 'inn':
        holders=[dict(name=n,label=label(n),race=label(d['race'],'race'),level=d['lvl'],initial=True,unlock=UNLOCKS.get(n,'')) for n,d in PLAYABLE.items() if INNATE.get(n)==name]
        if not holders:raise ValueError('该技能不在当前资料范围内。')
        return dict(**innate_skill(name),demons=sorted(holders,key=lambda d:(d['level'],d['name'])),essences=[],version=VERSION,source=COMMIT)
    from essences import essence_catalog
    essence_sources=[]
    for e in essence_catalog():
        entry=next((s for s in e['skills'] if s['name']==name),None)
        if entry:essence_sources.append(dict(name=e['name'],label=e['label'],group=e['group'],restriction=entry['restriction'],transferable=entry['transferable']))
    demons=[]
    for demon,d in PLAYABLE.items():
        if name in d['skills']:
            level=d['skills'][name]
            demons.append(dict(name=demon,label=label(demon),race=label(d['race'],'race'),level=max(d['lvl'],int(level)),initial=level<1,unlock=UNLOCKS.get(demon,'')))
    if not essence_sources and not demons:raise ValueError('该技能不在当前资料范围内。')
    skill=SKILLS[name]
    explanation=explain(skill['raw'])
    unique=not transferable(name)
    restrictions=sorted({e['restriction'] for e in essence_sources if e['restriction']})
    return dict(name=name,label=label(name,'skill'),unique=unique,restriction='／'.join(restrictions) if unique else '可通过合体或灵体继承',element=skill['element'],**explanation,demons=sorted(demons,key=lambda d:(d['level'],d['name'])),essences=essence_sources,version=VERSION,source=COMMIT)
