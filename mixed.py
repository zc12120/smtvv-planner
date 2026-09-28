"""Joint fusion + free essence optimization; essence arcs exist at EVERY demon."""
import json
from essences import ESSENCES, candidates
from planner import PLAYABLE, SPECIAL, UNLOCKS, PREREQS, VERSION, transferable
from search_graph import context_topology

def problem(context):
    choices=candidates(context.skills,context.sources)
    real,graph=context_topology(context,len(choices));ids={n:i for i,n in enumerate(real)}
    names=list(real)+['@'+e['name'] for mask,e in choices]
    native=[context.native[n] for n in real]+[mask for mask,e in choices]+[0]*(graph.nodes-len(names))
    prices=[context.prices[n] if n!=context.target and (context.starting is None or n in context.starting) else -1 for n in real]+[0]*len(choices)
    arcs=[]
    for index,(mask,e) in enumerate(choices,len(real)):
        for n in real:
            if mask&~context.native[n]:arcs.append((ids[n],index,ids[n],1))
    header=f'{len(native)} {len(names)} {len(context.skills)} {ids[context.target]} {len(graph.arcs)+len(arcs)}'
    text='\n'.join([header,' '.join(map(str,native)),' '.join(map(str,prices))])+'\n'+graph.text+''.join(f'{a} {b} {result} {step}\n' for a,b,result,step in arcs)
    return names,len(real),text

def decode(context,payload,names,real_count):
    nodes=[]
    for raw in payload['nodes']:
        children=[]
        for child in raw['children']:
            item=nodes[child]
            if isinstance(item,tuple):children.extend(item)
            else:children.append(item)
        entity=raw['entity']
        if entity>=len(names):nodes.append(tuple(children));continue
        if entity>=real_count:
            nodes.append(dict(kind='item',name=names[entity][1:],mask=raw['mask']));continue
        name=names[entity];items=[c for c in children if c['kind']=='item']
        if items:
            carriers=[c for c in children if c['kind']!='item']
            if len(items)!=1 or len(carriers)!=1 or carriers[0]['name']!=name:raise ValueError('灵体步骤结构不正确。')
            node=dict(kind='essence',name=name,essence=items[0]['name'],children=carriers,mask=raw['mask'])
        elif children:
            expected=next((ins for ins in context.reverse[name] if sorted(ins)==sorted(c['name'] for c in children)),None)
            if expected is None:raise ValueError('综合路线合体配方不匹配。')
            lookup={c['name']:c for c in children};node=dict(kind='fusion',name=name,children=[lookup[n] for n in expected],mask=raw['mask'])
        else:node=dict(kind='material',name=name,children=[],mask=raw['mask'])
        node.update(cost=raw['cost'],operations=raw['steps']);nodes.append(node)
    tree=nodes[payload['root']];materials=[];steps=[];known={};origins={};levels={};fusion_count=0;essence_count=0
    def natural(n,mid,skill):
        raw=PLAYABLE[n]['skills'][skill]
        return dict(name=n,id=mid,level=max(PLAYABLE[n]['lvl'],int(raw)),initial=raw<1)
    def visit(node):
        nonlocal fusion_count,essence_count
        n=node['name'];own_unique=context.unique if n==context.target else []
        if node['kind']=='material':
            mid='m'+str(len(materials)+1);learn=context.names(node['mask'])
            materials.append(dict(id=mid,name=n,learn=learn,price=context.prices[n],level=max([PLAYABLE[n]['lvl']]+[int(PLAYABLE[n]['skills'][s]) for s in learn]),unlock=UNLOCKS.get(n,PREREQS.get(n,''))))
            known[mid]=learn;origins[mid]={s:[natural(n,mid,s)] for s in learn};levels[mid]=materials[-1]['level'];return mid
        ids=[visit(c) for c in node['children']];sid='s'+str(len(steps)+1)
        if node['kind']=='essence':
            essence_count+=1;source=ids[0];e=ESSENCES[node['essence']]
            grants=context.names(node['mask']&~node['children'][0]['mask'])
            if any(s not in e['skills'] for s in grants):raise ValueError('灵体不包含所授技能。')
            keep=list(dict.fromkeys(known[source]+grants))
            given={s:dict(name=e['name'],id=sid,kind='essence',label=e['label']) for s in grants}
            current={s:list(v) for s,v in origins[source].items()}
            for skill,origin in given.items():current[skill]=[origin]
            step=dict(type='essence',id=sid,number=len(steps)+1,result=n,sourceId=source,essence=e['name'],essenceLabel=e['label'],grant=grants,grantSources=given,keep=keep,inherit=[],learn=[],level=levels[source],cost=0)
        else:
            fusion_count+=1;inherited=0
            for child in node['children']:inherited|=child['mask']
            inh=context.names(inherited);learn=context.names(node['mask']&~inherited)+own_unique
            ins=[c['name'] for c in node['children']];carriers={};current={}
            for skill in inh:
                carriers[skill]=[dict(name=name,id=mid) for mid,name in zip(ids,ins) if skill in known[mid]]
                merged={}
                for mid in ids:
                    for source in origins[mid].get(skill,[]):merged[(source['id'],source['name'])]=source
                current[skill]=list(merged.values())
            learned={s:natural(n,sid,s) for s in learn}
            for skill,origin in learned.items():current[skill]=[origin]
            keep=context.names(node['mask'])+own_unique
            step=dict(type='fusion',id=sid,number=len(steps)+1,result=n,ingredients=ins,materialIds=ids,inherit=inh,inheritSources=carriers,learn=learn,learnSources=learned,keep=keep,level=max([PLAYABLE[n]['lvl']]+[int(PLAYABLE[n]['skills'][s]) for s in learn]),special=n in SPECIAL,unlock=UNLOCKS.get(n,''),reason=context.graph.reason(n,ins))
        known[sid]=keep;origins[sid]=current;levels[sid]=step['level'];steps.append(step);return sid
    final=visit(tree)
    used={m['name'] for m in materials}|{s['result'] for s in steps}
    route=dict(found=True,objective='mixed',target=context.target,skills=context.selected,materials=materials,steps=steps,finalId=final,skillSources={s:origins[final][s] for s in context.selected},totalCost=tree['cost'],stepCount=len(steps),operationCount=len(steps),fusionCount=fusion_count,essenceCount=essence_count,conditions={n:UNLOCKS.get(n,PREREQS.get(n,'')) for n in used if UNLOCKS.get(n,PREREQS.get(n,''))},priceMode=context.price_mode,version=VERSION,optimal=True,allEssencesOwned=True,essenceCost=0)
    validate(context,route)
    if route['operationCount']!=tree['operations']:raise ValueError('综合路线操作次数不一致。')
    route['validated']=True;return route

def validate(context,route):
    """Independent replay: consume carriers, check essence content and provenance."""
    available={};total=0;fusions=0;essences=0
    def fail():raise ValueError('综合路线校验失败，已停止输出。')
    for m in route['materials']:
        n=m['name']
        if n not in context.allowed or n==context.target or context.starting is not None and n not in context.starting:fail()
        if not PLAYABLE[n]['lvl']<=m['level']<=context.level:fail()
        learned={}
        for s in m['learn']:
            if s not in PLAYABLE[n]['skills'] or PLAYABLE[n]['skills'][s]>m['level']:fail()
            learned[s]={n}
        if m['id'] in available or len(learned)>context.slots:fail()
        available[m['id']]=(n,learned,m['level']);total+=context.prices[n]
    for step in route['steps']:
        n=step['result']
        if n not in context.allowed:fail()
        if step['type']=='essence':
            essences+=1;e=ESSENCES.get(step['essence']);old=available.pop(step['sourceId'],None)
            if not e or not old or old[0]!=n or step['level']!=old[2]:fail()
            carry={s:set(v) for s,v in old[1].items()}
            for s in step['grant']:
                if not transferable(s) or s not in e['skills']:fail()
                if s in context.sources and context.sources[s]!=e['name']:fail()
                carry[s]={e['name']}
            if set(step['keep'])!=set(carry) or step['cost']!=0:fail()
        else:
            fusions+=1;ins=step['ingredients']
            if len(step['materialIds'])!=len(ins):fail()
            if len(ins)==2:
                if context.graph.fuse(*ins)!=n:fail()
            elif sorted(SPECIAL.get(n,[]))!=sorted(ins):fail()
            if context.graph.reason(n,ins) and not context.uncertain:fail()
            all_skills={}
            for mid,name in zip(step['materialIds'],ins):
                child=available.pop(mid,None)
                if not child or child[0]!=name:fail()
                for skill,where in child[1].items():all_skills.setdefault(skill,set()).update(where)
            carry={}
            for skill in step['inherit']:
                if not transferable(skill) or skill not in all_skills:fail()
                carry[skill]=all_skills[skill]
            if not PLAYABLE[n]['lvl']<=step['level']<=context.level:fail()
            for skill in step['learn']:
                if skill not in PLAYABLE[n]['skills'] or PLAYABLE[n]['skills'][skill]>step['level']:fail()
                carry.setdefault(skill,set()).add(n)
            if set(carry)!=set(step['keep']):fail()
        if len(carry)>context.slots:fail()
        if step['id'] in available:fail()
        available[step['id']]=(n,carry,step['level'])
    result=available.get(route['finalId'])
    if not result or len(available)!=1 or result[0]!=context.target or not set(context.selected)<=set(result[1]):fail()
    for skill,source in context.sources.items():
        if source not in result[1].get(skill,set()):fail()
    if total!=route['totalCost'] or fusions!=route['fusionCount'] or essences!=route['essenceCount']:fail()

def solve(context):
    names,count,data=problem(context)
    if context.cancelled.is_set():return None
    if not context.start_engine(data,['--shortest-only']):return None
    payload=None
    for line in context.process.stdout:
        if context.cancelled.is_set():context.process.terminate();return None
        payload=json.loads(line)
    code=context.process.wait()
    if code:
        if context.cancelled.is_set():return None
        raise ValueError('综合计算引擎异常：'+context.process.stderr.read()[:200])
    return decode(context,payload,names,count) if payload and payload['found'] else None
