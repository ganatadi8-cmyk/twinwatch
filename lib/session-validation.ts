import { z } from 'zod';
const angle=z.number().finite().min(0).max(180).nullable();
const time=z.number().finite().min(0).max(86400);
export const sessionSchema=z.object({
  id:z.string().uuid(),source:z.enum(['video','webcam','csv']),name:z.string().trim().min(1).max(200),createdAt:z.string().datetime(),duration:time,frames:z.number().int().min(0).max(1000000),trackedFrames:z.number().int().min(0).max(1000000),
  rules:z.object({trunk:z.number().min(10).max(80),arm:z.number().min(45).max(160),hold:z.number().min(1).max(20),confidence:z.number().min(.3).max(.95)}),
  alerts:z.array(z.object({id:z.string().uuid(),kind:z.enum(['trunk','arm']),title:z.string().max(80),message:z.string().max(200),start:time,end:time,duration:time,peak:z.number().finite().min(0).max(180),threshold:z.number().min(0).max(180),status:z.enum(['active','resolved','tracking lost','session ended']),acknowledged:z.boolean()})).max(500),
  samples:z.array(z.object({time,trunk:angle,arm:angle})).max(600),
}).refine(s=>s.trackedFrames<=s.frames&&s.alerts.every(a=>a.end>=a.start&&a.end<=s.duration+1)&&s.samples.every(a=>a.time<=s.duration+1),'Session contains inconsistent measurements.');
