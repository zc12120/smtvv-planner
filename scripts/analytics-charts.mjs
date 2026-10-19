// Local, tree-shaken Apache ECharts runtime. Loaded only by the admin analytics section.
import {init, getInstanceByDom, use, version} from 'echarts/core';
import {LineChart, BarChart, PieChart, HeatmapChart} from 'echarts/charts';
import {GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, AriaComponent, TitleComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';

use([LineChart, BarChart, PieChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, VisualMapComponent, AriaComponent, TitleComponent, SVGRenderer]);
window.SmtvvCharts = {init, getInstanceByDom, version};
