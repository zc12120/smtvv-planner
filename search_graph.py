"""Bounded, immutable caches for the shared fusion topology.

Skill masks, prices, starting materials and search results never enter the graph
cache. Callers receive their own mutable reverse index for route enumeration.
"""
from collections import defaultdict
from functools import lru_cache
from typing import NamedTuple


@lru_cache(maxsize=8)
def filtered_recipes(graph, names, uncertain):
    allowed = frozenset(names)
    reverse = defaultdict(list)
    for result, ingredients in graph.recipes:
        if result in allowed and all(name in allowed for name in ingredients):
            if uncertain or not graph.reason(result, ingredients):
                reverse[result].append(ingredients)
    return tuple((name, tuple(recipes)) for name, recipes in reverse.items())


class Topology(NamedTuple):
    nodes: int
    arcs: tuple
    text: str


@lru_cache(maxsize=8)
def topology(names, recipes, extra_leaves=0):
    ids = {name: index for index, name in enumerate(names)}
    nodes = len(names) + extra_leaves
    arcs = []
    for result, alternatives in recipes:
        for ingredients in alternatives:
            parts = [ids[name] for name in ingredients]
            left = parts[0]
            for index, right in enumerate(parts[1:], 1):
                final = index == len(parts) - 1
                out = ids[result] if final else nodes
                if not final:
                    nodes += 1
                arcs.append((left, right, out, int(final)))
                left = out
    encoded = ''.join(f'{a} {b} {result} {step}\n' for a, b, result, step in arcs)
    return Topology(nodes, tuple(arcs), encoded)


def context_topology(context, extra_leaves=0):
    names = tuple(sorted(context.allowed))
    # Include the actual recipes: callers and regression fixtures may restrict
    # an individual context after construction without changing its settings.
    recipes = tuple((name, tuple(alternatives)) for name, alternatives in context.reverse.items())
    return names, topology(names, recipes, extra_leaves)
