"use client";
import { LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceLine,ResponsiveContainer } from 'recharts';
import type { Sample,Rules } from '@/lib/posture';
import { formatTime } from '@/lib/posture';
import { ChartNoAxesCombined } from 'lucide-react';
export default function PostureChart({samples,rules}:{samples:Sample[];rules:Rules}){
  if(samples.length<2)return <div className="chart-empty"><ChartNoAxesCombined size={24}/><p>Posture readings will appear here</p><span>Start a session to track changes over time.</span></div>;
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={samples} margin={{top:8,right:18,left:-18,bottom:0}}><CartesianGrid stroke="#e8edf0" vertical={false}/><XAxis dataKey="time" tickFormatter={formatTime} tick={{fill:'#79838d',fontSize:12}} minTickGap={45} axisLine={false} tickLine={false}/><YAxis domain={[0,180]} ticks={[0,45,90,135,180]} tick={{fill:'#79838d',fontSize:12}} axisLine={false} tickLine={false} unit="°"/><Tooltip labelFormatter={v=>formatTime(Number(v))} formatter={(v,n)=>[`${Number(v).toFixed(1)}°`,n==='trunk'?'Trunk lean':'Arm elevation']} contentStyle={{borderRadius:10,borderColor:'#e0e5eb',fontSize:14}}/><ReferenceLine y={rules.trunk} stroke="#c18e4d" strokeDasharray="4 4"/><Line dataKey="trunk" stroke="#3659bb" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/><Line dataKey="arm" stroke="#66a596" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>;
}
