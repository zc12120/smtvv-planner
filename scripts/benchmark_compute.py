"""Measure exact engine stages; first-build compilation and queueing are excluded."""
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get('SMTVV_BENCHMARK_ROOT', Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(ROOT))
from optimal import OptimalSearch
from mixed import problem as mixed_problem, decode as mixed_decode

CASES = {
    'early_two_skills': {'target':'Angel','skills':['Agi','Dia']},
    'eight_slot_build': {'target':'Yoshitsune','skills':['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']},
    'eight_transferable': {'target':'Alice','skills':['Agi','Bufu','Zio','Zan','Hama','Mudo','Dia','Lunge']},
    'fixed_source': {'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Metatron'}},
}

def run(request):
    times = {}
    def measure(name, call):
        start=time.perf_counter();value=call();times[name]=(time.perf_counter()-start)*1000;return value
    job=measure('prepare', lambda:OptimalSearch(request))
    names,_,_,_,data=measure('fusion_problem',job.problem)
    command=job.engine_command()
    output=measure('fusion_native',lambda:subprocess.run(command,input=data,text=True,capture_output=True,check=True,timeout=90))
    fusion=measure('fusion_replay',lambda:[job.decode(json.loads(line),names) for line in output.stdout.splitlines() if json.loads(line)['found']])
    names,count,data=measure('mixed_problem',lambda:mixed_problem(job))
    output=measure('mixed_native',lambda:subprocess.run(command+['--shortest-only'],input=data,text=True,capture_output=True,check=True,timeout=90))
    payload=json.loads(output.stdout)
    combined=measure('mixed_replay',lambda:mixed_decode(job,payload,names,count) if payload['found'] else None)
    result={route['objective']:{'cost':route['totalCost'],'operations':route.get('operationCount',route.get('stepCount')),'settled':route.get('settledStates'),'validated':route['validated']} for route in fusion+([combined] if combined else [])}
    times['total']=sum(times.values())
    return {'timesMs':{key:round(value,3) for key,value in times.items()},'objectives':result}

report={}
for name,request in CASES.items():
    runs=[run(request) for _ in range(3)]
    report[name]={'request':request,'runs':runs,'medianMs':{key:round(statistics.median(run['timesMs'][key] for run in runs),3) for key in runs[0]['timesMs']}}
    print(name, report[name]['medianMs'], flush=True)
destination=Path(sys.argv[1])
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(json.dumps(report,indent=2)+'\n')
