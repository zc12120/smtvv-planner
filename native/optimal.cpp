// Label-setting shortest derivations in a binary AND/OR hypergraph.
// Nonnegative additive (fusion steps, summon price); no depth/step bound.
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <queue>
#include <string>
#include <vector>
using I = long long;
const I INF=(1LL<<60);
struct Weight {I first=INF,second=INF;};
bool operator<(Weight a,Weight b){return a.first<b.first||(a.first==b.first&&a.second<b.second);}
bool operator==(Weight a,Weight b){return a.first==b.first&&a.second==b.second;}
bool le(Weight a,Weight b){return a<b||a==b;}
struct Edge {int other,result,step;};
struct Item {Weight weight;int id;};
struct Compare {bool operator()(const Item&a,const Item&b)const{return b.weight<a.weight||(a.weight==b.weight&&a.id>b.id);}};
struct Back {int left=-1,right=-1;};
struct Problem {int n,real,bits,goal;std::vector<int> native;std::vector<I> prices;std::vector<std::vector<Edge>> edges;};
struct Solver {
 const Problem&p;bool byCost;int size,maskLimit,target,settled=0;Weight upper;std::vector<Weight> dist,cover;std::vector<char> done;std::vector<Back> back;std::vector<std::vector<int>> active;std::priority_queue<Item,std::vector<Item>,Compare> queue;
 Solver(const Problem& p_,bool byCost_,Weight upper_=Weight{}):p(p_),byCost(byCost_),size(1<<p.bits),maskLimit(size-1),target(p.goal*size+maskLimit),upper(upper_),dist(p.n*size),cover(p.n*size),done(p.n*size,0),back(p.n*size),active(p.n){}
 // All increments are nonnegative. A partial derivation above a proven complete
 // route cannot improve that route; equality remains eligible for zero-cost arcs.
 void relax(int id,Weight w,int a=-1,int b=-1){if(upper<w||done[id]||le(cover[id],w)||! (w<dist[id]))return;dist[id]=w;back[id]={a,b};if(id==target&&w<upper)upper=w;queue.push({w,id});}
 int solve(){
  for(int n=0;n<p.real;n++)if(p.prices[n]>=0){Weight w=byCost?Weight{p.prices[n],0}:Weight{0,p.prices[n]};relax(n*size+p.native[n],w);}
  while(!queue.empty()){
   auto item=queue.top();queue.pop();int id=item.id;if(done[id]||!(dist[id]==item.weight))continue;
   if(le(cover[id],item.weight))continue;
   done[id]=1;settled++;int entity=id>>p.bits,mask=id&maskLimit;
   for(int sub=mask;;sub=(sub-1)&mask){int key=entity*size+sub;if(item.weight<cover[key])cover[key]=item.weight;if(sub==0)break;}
   if(id==target)return id;
   active[entity].push_back(id);
   for(const auto&e:p.edges[entity]){
    for(int other:active[e.other]){
     Weight w{item.weight.first+dist[other].first,item.weight.second+dist[other].second};
     if(w.first>=INF||w.second>=INF)continue;
     if(byCost)w.second+=e.step;else w.first+=e.step;
     int newmask=mask|(other&maskLimit)|p.native[e.result];int dest=e.result*size+newmask;
     relax(dest,w,id,other);
    }
   }
  }
  return -1;
 }
 int emitNode(int id,std::vector<int>&ids,std::vector<int>&index){
  if(index[id]>=0)return index[id];
  auto b=back[id];if(b.left>=0){emitNode(b.left,ids,index);emitNode(b.right,ids,index);}
  index[id]=ids.size();ids.push_back(id);return index[id];
 }
 void output(int goal,const char*name){
  std::cout<<"{\"objective\":\""<<name<<"\",\"settled\":"<<settled<<",\"found\":"<<(goal>=0?"true":"false");
  if(goal>=0){
   std::vector<int> ids,index(p.n*size,-1);int root=emitNode(goal,ids,index);
   std::cout<<",\"root\":"<<root<<",\"nodes\":[";
   for(size_t i=0;i<ids.size();i++){
    int id=ids[i];if(i)std::cout<<',';
    I cost=byCost?dist[id].first:dist[id].second,steps=byCost?dist[id].second:dist[id].first;
    std::cout<<"{\"entity\":"<<(id>>p.bits)<<",\"mask\":"<<(id&maskLimit)<<",\"cost\":"<<cost<<",\"steps\":"<<steps<<",\"children\":[";
    if(back[id].left>=0)std::cout<<index[back[id].left]<<','<<index[back[id].right];
    std::cout<<"]}";
   }
   std::cout<<"]";
  }
  std::cout<<"}"<<std::endl;
 }
};
int main(int argc,char** argv){
 std::ios::sync_with_stdio(false);std::cin.tie(nullptr);
 Problem p;int arcs;if(!(std::cin>>p.n>>p.real>>p.bits>>p.goal>>arcs))return 2;
 if(p.n<1||p.n>2000||p.real<1||p.real>p.n||p.bits<0||p.bits>8||p.goal<0||p.goal>=p.real||arcs<0||arcs>100000)return 2;
 p.native.resize(p.n);p.prices.resize(p.real);p.edges.resize(p.n);
 for(auto&x:p.native)if(!(std::cin>>x)||x<0||x>=(1<<p.bits))return 2;
 for(auto&x:p.prices)if(!(std::cin>>x)||x<-1||x>=INF)return 2;
 for(int i=0;i<arcs;i++){int a,b,r,s;if(!(std::cin>>a>>b>>r>>s)||a<0||b<0||r<0||a>=p.n||b>=p.n||r>=p.n||a==b||s<0||s>1)return 2;p.edges[a].push_back({b,r,s});p.edges[b].push_back({a,r,s});}
 if(!std::cin)return 2;
 bool single=argc>1&&std::string(argv[1])=="--shortest-only";
 Weight cheapestBound;
 for(bool cost:{false,true}){if(single&&cost)break;Solver solver(p,cost,cost?cheapestBound:Weight{});int goal=solver.solve();solver.output(goal,cost?"cheapest":"shortest");if(!cost&&goal>=0)cheapestBound={solver.dist[goal].second,solver.dist[goal].first};}
 return 0;
}
