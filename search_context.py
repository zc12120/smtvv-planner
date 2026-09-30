"""Per-request search inputs and materialization, independent of search strategy."""
from collections import defaultdict
from configuration import parse_config
from game_data import (PLAYABLE, SKILLS, SPECIAL, UNLOCKS, PREREQS, VERSION,
                       read, transferable, string_list)
from planner import settings, validate_route, annotate_skill_sources
from search_graph import filtered_recipes

BASE_PRICES = {n: 2 * price for n, price in read('comp-costs').items() if n in PLAYABLE}

class SearchContext:
    def __init__(self, request, kind='optimal'):
        config = parse_config(request, kind)
        self.request = config
        self.target = config['target']
        self.graph, self.level, self.slots, self.excluded, self.uncertain = settings(config)
        self.selected = string_list(request.get('skills', []), '技能', SKILLS)
        self.allowed = {n for n, d in self.graph.demons.items() if n not in self.excluded and d['lvl'] <= self.level}
        self.skills = [s for s in self.selected if transferable(s)]
        self.unique = [s for s in self.selected if not transferable(s)]
        self.sources = config['sources']
        self.full = (1 << len(self.skills)) - 1
        self.native = {n: sum(1 << i for i, s in enumerate(self.skills)
                       if s in PLAYABLE[n]['skills'] and PLAYABLE[n]['skills'][s] <= self.level
                       and (s not in self.sources or self.sources[s] == n)) for n in self.allowed}
        self.prices = BASE_PRICES | config['prices']
        self.price_mode = 'custom' if config['prices'] else 'baseline'
        self.starting = None if config['starting'] is None else set(config['starting'])
        self.reverse = defaultdict(list, {name: list(recipes) for name, recipes in
            filtered_recipes(self.graph, tuple(sorted(self.allowed)), self.uncertain)})

    def names(self,mask):return [s for i,s in enumerate(self.skills) if mask&(1<<i)]
    def materialize(self,tree):
        materials=[];steps=[]
        def visit(t,root=False):
            if not t.children:
                mid='m'+str(len(materials)+1);learn=self.names(t.mask)
                materials.append(dict(id=mid,name=t.name,learn=learn,level=max([PLAYABLE[t.name]['lvl']]+[int(PLAYABLE[t.name]['skills'][s]) for s in learn]),price=self.prices[t.name],unlock=UNLOCKS.get(t.name,PREREQS.get(t.name,''))))
                return mid
            ids=[visit(c) for c in t.children];inherited=0
            for c in t.children:inherited|=c.mask
            learn=self.names(t.mask&~inherited)+(self.unique if root else [])
            sid='s'+str(len(steps)+1);ins=[c.name for c in t.children]
            steps.append(dict(id=sid,number=len(steps)+1,result=t.name,ingredients=ins,materialIds=ids,inherit=self.names(inherited),learn=learn,keep=self.names(t.mask)+(self.unique if root else []),level=max([PLAYABLE[t.name]['lvl']]+[int(PLAYABLE[t.name]['skills'][s]) for s in learn]),special=t.name in SPECIAL,unlock=UNLOCKS.get(t.name,''),reason=self.graph.reason(t.name,ins)))
            return sid
        final=visit(tree,True)
        names={m['name'] for m in materials}|{s['result'] for s in steps}
        route=dict(found=True,target=self.target,skills=self.selected,materials=materials,steps=steps,finalId=final,conditions={n:UNLOCKS.get(n,PREREQS.get(n,'')) for n in names if UNLOCKS.get(n,PREREQS.get(n,''))},totalCost=tree.cost,stepCount=tree.steps,version=VERSION,priceMode=self.price_mode)
        validate_route(route,self.graph,self.selected,self.sources,self.level,self.slots,self.excluded,self.uncertain)
        if len(steps)!=tree.steps or sum(m['price'] for m in materials)!=tree.cost:raise ValueError('路线计数或费用校验失败。')
        route['validated']=True;return annotate_skill_sources(route)

