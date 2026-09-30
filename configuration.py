"""One authoritative validation path for local and distributed calculation."""
from dataclasses import dataclass
from game_data import DLC, PLAYABLE, SKILLS, string_list, transferable, label

OBJECTIVES = ('mixed', 'shortest', 'cheapest')

def objective(value='mixed'):
    if not isinstance(value, str) or value not in (*OBJECTIVES, 'all'):
        raise ValueError('请选择有效的优化方案。')
    return value

@dataclass(frozen=True, slots=True)
class Settings:
    level: int
    slots: int
    dlc: tuple
    locked: tuple
    excluded: tuple
    allow_uncertain: bool

    @classmethod
    def parse(cls, request):
        if not isinstance(request, dict):
            raise ValueError('计算请求格式不合法。')
        level, slots = request.get('level', 150), request.get('slots', 8)
        if type(level) is not int or type(slots) is not int:
            raise ValueError('等级和技能栏位必须为整数。')
        if not 1 <= level <= 150 or not 1 <= slots <= 8:
            raise ValueError('等级须为 1–150；技能栏位须为 1–8。')
        dlc = request.get('dlc', True)
        if isinstance(dlc, bool):
            dlc = list(DLC) if dlc else []
        values = [tuple(sorted(string_list(value, title, valid))) for value, title, valid in (
            (dlc, 'DLC', DLC), (request.get('locked', []), '未解锁仲魔', PLAYABLE),
            (request.get('excluded', []), '排除仲魔', PLAYABLE))]
        uncertain = request.get('allowUncertain', False)
        if type(uncertain) is not bool:
            raise ValueError('待核实配方开关必须为布尔值。')
        return cls(level, slots, *values, uncertain)

    def as_request(self):
        return dict(level=self.level, slots=self.slots, dlc=list(self.dlc),
                    locked=list(self.locked), excluded=list(self.excluded),
                    allowUncertain=self.allow_uncertain)

def parse_config(request, kind='optimal'):
    """Validate without constructing a fusion graph on the coordinator."""
    if not isinstance(request, dict):
        raise ValueError('计算请求格式不合法。')
    base = Settings.parse(request)
    config = base.as_request()
    level, slots = base.level, base.slots
    available = {n for n in PLAYABLE if (n not in DLC or n in config['dlc']) and n not in config['locked']}
    if kind == 'fuse':
        config['materials'] = sorted(string_list(request.get('materials', []), '合体材料', PLAYABLE))
        if not 2 <= len(config['materials']) <= 4 or not set(config['materials']) <= available:
            raise ValueError('请选择 2–4 只可用的不同仲魔。')
        return config
    target = request.get('target')
    if not isinstance(target, str) or target not in available:
        raise ValueError('请选择可用的目标仲魔。')
    config['target'] = target
    if kind == 'recipes':
        return config
    allowed = {n for n in available if n not in config['excluded'] and PLAYABLE[n]['lvl'] <= level}
    if target not in allowed:
        raise ValueError('目标受到等级、DLC、未解锁或排除设置限制。')
    selected = sorted(string_list(request.get('skills', []), '技能', SKILLS))
    if len(selected) > slots:
        raise ValueError('所选技能超过可用栏位。')
    for skill in selected:
        if not transferable(skill) and (skill not in PLAYABLE[target]['skills'] or PLAYABLE[target]['skills'][skill] > level):
            raise ValueError(label(skill, 'skill') + ' 不可继承，且无法由目标自身习得。')
    sources = request.get('sources', {})
    if not isinstance(sources, dict):
        raise ValueError('技能来源格式不正确。')
    for skill, name in sources.items():
        if (skill not in selected or not isinstance(name, str) or name not in allowed
                or skill not in PLAYABLE[name]['skills'] or PLAYABLE[name]['skills'][skill] > level
                or (not transferable(skill) and name != target)):
            raise ValueError('指定技能来源不可用。')
    prices = request.get('prices', {})
    if not isinstance(prices, dict) or any(n not in PLAYABLE or type(p) is not int or not 0 <= p <= 100000000 for n, p in prices.items()):
        raise ValueError('请填写有效的仲魔召唤价格（非负整数）。')
    starting = request.get('starting')
    if starting is not None:
        starting = sorted(string_list(starting, '可用起始材料', PLAYABLE))
    config.update(skills=selected, sources=sources.copy(), prices=prices.copy(), starting=starting)
    if kind == 'optimal':
        config['objective'] = objective(request.get('objective', 'mixed'))
    if kind == 'routes':
        try:
            steps = int(request.get('maxSteps', 3))
        except (TypeError, ValueError):
            raise ValueError('最大合体次数须为整数。')
        if not 1 <= steps <= 6:
            raise ValueError('最大合体次数可设置为 1–6 次。')
        config['maxSteps'] = steps
    return config

