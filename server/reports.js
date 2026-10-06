import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import {query} from './db.js';
export async function report(req,res,cid){
 const t=req.user.tenant,type=req.params.type;
 const institution=(await query('SELECT * FROM institutions WHERE id=$1',[t])).rows[0];
 const settings=institution.settings;
 const committees=(await query('SELECT * FROM committees WHERE tenant=$1 AND ($2::text IS NULL OR id=$2)',[t,cid])).rows;
 const ids=committees.map(c=>c.id);
 const allocations=(await query('SELECT a.*,u.name,u.department,u.gender,c.name AS committee FROM allocations a JOIN users u ON u.id=a.user_id JOIN committees c ON c.id=a.committee_id WHERE a.tenant=$1 AND a.committee_id=ANY($2::text[])',[t,ids])).rows;
 const meetings=(await query('SELECT m.*,c.name AS committee FROM meetings m JOIN committees c ON c.id=m.committee_id WHERE m.tenant=$1 AND m.committee_id=ANY($2::text[]) ORDER BY starts_at',[t,ids])).rows;
 const attendance=(await query('SELECT a.*,u.name FROM attendance a JOIN users u ON u.id=a.user_id JOIN meetings m ON m.id=a.meeting_id WHERE a.tenant=$1 AND m.committee_id=ANY($2::text[])',[t,ids])).rows;
 const allConflicts=(await query('SELECT * FROM conflicts WHERE tenant=$1 AND committee_id=ANY($2::text[])',[t,ids])).rows;const conflicts=allConflicts.filter(c=>c.active);
 const actions=(await query('SELECT a.* FROM actions a JOIN meetings m ON m.id=a.meeting_id WHERE a.tenant=$1 AND m.committee_id=ANY($2::text[])',[t,ids])).rows;
 let headings,rows;
 const today=new Date().toISOString().slice(0,10);
 const active=allocations.filter(a=>a.status==='ACTIVE'&&a.start_date<=today&&a.end_date>=today);
 if(type==='governance'){
 headings=['Committee','Seats filled','Expired terms','Open conflicts','Minutes awaiting approval','Overdue actions'];
 rows=committees.map(c=>[c.name,active.filter(a=>a.committee_id===c.id).length+'/'+c.seats,allocations.filter(a=>a.committee_id===c.id&&a.status==='ACTIVE'&&a.end_date<today).length,conflicts.filter(a=>a.committee_id===c.id).length,meetings.filter(m=>m.committee_id===c.id&&m.status!=='APPROVED'&&m.status!=='CANCELLED'&&new Date(m.starts_at)<new Date()).length,actions.filter(a=>meetings.find(m=>m.id===a.meeting_id)?.committee_id===c.id&&a.status==='OPEN'&&a.due_date<today).length]);
 }else if(type==='compliance'){
 headings=['Committee','Requirement / source','Status','Evidence / document','Independent reviewer','Review reason'];
 const checks=(await query('SELECT i.*,d.title AS document_title,ru.name AS reviewer_name,au.name AS appointment_name,a.role AS appointment_role,lm.title AS meeting_title FROM checklist_items i LEFT JOIN documents d ON d.id=i.document_id LEFT JOIN users ru ON ru.id=i.reviewed_by LEFT JOIN allocations a ON a.id=i.allocation_id LEFT JOIN users au ON au.id=a.user_id LEFT JOIN meetings lm ON lm.id=i.meeting_id WHERE i.tenant=$1 AND i.committee_id=ANY($2::text[]) ORDER BY i.created_at',[t,ids])).rows;
 rows=checks.map(i=>[committees.find(c=>c.id===i.committee_id)?.name,i.title+' — '+i.requirement+'\nSource: '+i.policy_reference,i.status+(i.due_date?' • Due '+i.due_date:''),i.evidence+(i.allocation_id?'\nAppointment: '+(i.appointment_name||'')+' '+(i.appointment_role||'')+' ('+i.allocation_id+')':'')+(i.meeting_id?'\nMeeting: '+(i.meeting_title||'')+' ('+i.meeting_id+')':'')+(i.document_title?'\nDocument: '+i.document_title:''),i.reviewer_name||'Not reviewed',i.review_reason]);
 }else if(type==='workload'){
 headings=['Member','Department','Gender','Active appointments','Committee roles'];const people=new Map(allocations.map(a=>[a.user_id,a]));rows=[...people.values()].map(u=>[u.name,u.department,u.gender,active.filter(a=>a.user_id===u.user_id).length,active.filter(a=>a.user_id===u.user_id).map(a=>a.committee+' ('+a.role+')').join('; ')]);
 }else if(type==='attendance'){
 headings=['Meeting','Committee','Date (CAT)','Member','Attendance'];rows=attendance.map(a=>{const m=meetings.find(m=>m.id===a.meeting_id);return [m.title,m.committee,new Date(m.starts_at).toLocaleString('en-GB',{timeZone:'Africa/Lusaka'}),a.name,a.present?'Present':'Absent']});
 }else if(type==='minutes'){
 headings=['Meeting','Committee','Date (CAT)','Status','Agenda','Minutes'];rows=meetings.map(m=>[m.title,m.committee,new Date(m.starts_at).toLocaleString('en-GB',{timeZone:'Africa/Lusaka'}),m.status,m.agenda,m.minutes||'No minutes recorded']);
 }else{
 headings=['Timestamp (CAT)','Actor ID','Action','Record','Evidence'];
 const audit=(await query('SELECT * FROM audit WHERE tenant=$1 ORDER BY created_at',[t])).rows;
 const entityIds=new Set([...ids,...allocations.map(a=>a.id),...meetings.map(m=>m.id),...actions.map(a=>a.id),...(await query('SELECT id FROM documents WHERE tenant=$1 AND committee_id=ANY($2::text[])',[t,ids])).rows.map(d=>d.id),...(await query('SELECT id FROM votes WHERE tenant=$1 AND meeting_id=ANY($2::text[])',[t,meetings.map(m=>m.id)])).rows.map(v=>v.id),...allConflicts.map(c=>c.id),...(await query('SELECT id FROM declarations WHERE tenant=$1 AND committee_id=ANY($2::text[])',[t,ids])).rows.map(d=>d.id),...(await query('SELECT id FROM checklist_items WHERE tenant=$1 AND committee_id=ANY($2::text[])',[t,ids])).rows.map(d=>d.id)]);
 rows=audit.filter(a=>!cid||entityIds.has(a.entity)).map(a=>[new Date(a.created_at).toLocaleString('en-GB',{timeZone:'Africa/Lusaka'}),a.user_id,a.action,a.entity,JSON.stringify(a.details)]);
 }
 const title=type==='compliance'?'Institutional evidence report':type[0].toUpperCase()+type.slice(1)+' report';
 const generated=new Date().toLocaleString('en-GB',{timeZone:'Africa/Lusaka'})+' CAT';
 if(req.params.format==='xlsx'){
 const book=new ExcelJS.Workbook();book.creator=req.user.name;book.created=new Date();const ws=book.addWorksheet(title,{views:[{state:'frozen',ySplit:4}]});
 ws.addRow([institution.name]);ws.addRow([title+' • '+generated]);ws.addRow(['Governance evidence only; confirm against approved institutional policies.']);ws.addRow(headings);
 for(const r of rows)ws.addRow(r);
 ws.columns=headings.map((h,i)=>({width:i===0?30:Math.min(55,Math.max(20,h.length+4))}));
 if(settings.logo){const buffer=Buffer.from(settings.logo.split(',')[1],'base64'),probe=new PDFDocument(),image=probe.openImage(buffer);probe.end();const id=book.addImage({buffer,extension:settings.logo.startsWith('data:image/png')?'png':'jpeg'});ws.addImage(id,{tl:{col:Math.max(1,headings.length-1),row:0},ext:{width:52*Math.min(1,image.width/image.height),height:40*Math.min(1,image.height/image.width)}});ws.getRow(1).height=45;}
 ws.getRow(1).font={size:20,bold:true,color:{argb:'FF143C37'}};ws.getRow(2).font={size:13,bold:true};ws.getRow(3).font={italic:true,size:10};ws.getRow(4).height=32;
 ws.getRow(4).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+(settings.primary||'#167568').slice(1)}};c.font={bold:true,color:{argb:'FFFFFFFF'}};c.alignment={wrapText:true,vertical:'middle'}});
 ws.eachRow((r,n)=>{if(n>4){r.height=type==='minutes'?100:40;r.eachCell(c=>{c.alignment={vertical:'top',wrapText:true};if(n%2)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F5F3'}}})}});
 ws.autoFilter={from:'A4',to:{row:4,column:headings.length}};ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1};
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="cms-${type}.xlsx"`);await book.xlsx.write(res);res.end();return;
 }
 const doc=new PDFDocument({size:'A4',layout:type==='minutes'?'portrait':'landscape',margin:40,bufferPages:true});
 res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="cms-${type}.pdf"`);doc.pipe(res);
 const color=settings.primary||'#167568',width=doc.page.width-80;
 function header(){doc.rect(0,0,doc.page.width,105).fill(color);if(settings.logo)try{doc.image(Buffer.from(settings.logo.split(',')[1],'base64'),40,24,{fit:[55,55]})}catch{}doc.fillColor('white').font('Helvetica-Bold').fontSize(20).text(institution.name,settings.logo?110:40,25,{width:width-80});doc.fontSize(11).font('Helvetica').text(title+'  /  '+generated,settings.logo?110:40,60,{width:width-80});doc.y=125;doc.x=40;doc.fillColor('#243b36');}
 header();doc.fontSize(10).text('Institutional evidence report. Findings require review against approved governance policies.');doc.moveDown();
 doc.font('Helvetica-Bold').fontSize(12).text(`${committees.length} committees   •   ${active.length} current appointments   •   ${meetings.length} meetings`);doc.moveDown();
 if(type==='minutes'){
 for(const r of rows){if(doc.y>doc.page.height-180){doc.addPage();header()}doc.font('Helvetica-Bold').fontSize(16).text(r[0]);doc.font('Helvetica').fontSize(10).text(r[1]+' • '+r[2]+' • '+r[3]);doc.moveDown();doc.font('Helvetica-Bold').fontSize(11).text('Agenda');doc.font('Helvetica').text(r[4]);doc.moveDown();doc.font('Helvetica-Bold').text('Minutes');doc.font('Helvetica').text(r[5]);doc.moveDown(2)}
 }else{
 const col=width/headings.length;
 function tableHead(){const y=doc.y;doc.rect(40,y,width,40).fill(color);headings.forEach((h,i)=>doc.fillColor('white').font('Helvetica-Bold').fontSize(9).text(h,46+i*col,y+8,{width:col-12,height:30}));doc.y=y+40;}
 tableHead();
 for(const r of rows){doc.font('Helvetica').fontSize(9);const cells=r.map(x=>String(x??''));let height=Math.max(36,...cells.map(x=>doc.heightOfString(x,{width:col-12})+16));
 // Long audit details continue as individual labelled blocks to avoid clipped cells.
 if(height>doc.page.height-190){if(doc.y>180){doc.addPage();header()}for(let i=0;i<cells.length;i++){doc.font('Helvetica-Bold').text(headings[i]+':');doc.font('Helvetica').text(cells[i]);doc.moveDown(.4)}doc.moveDown();continue;}
 if(doc.y+height>doc.page.height-65){doc.addPage();header();tableHead()}
 const y=doc.y;doc.rect(40,y,width,height).fill(rows.indexOf(r)%2?'#f0f5f3':'#ffffff');cells.forEach((x,i)=>doc.fillColor('#243b36').font('Helvetica').fontSize(9).text(x,46+i*col,y+8,{width:col-12,height:height-12}));doc.y=y+height;
 }
 }
 if(!rows.length)doc.fillColor('#64756f').text('No records match this report.');
 const range=doc.bufferedPageRange();for(let p=range.start;p<range.start+range.count;p++){doc.switchToPage(p);const bottom=doc.page.height-40;doc.page.margins.bottom=0;doc.fontSize(8).fillColor('#64756f').text((settings.reportFooter||'Committee governance')+' • Generated by '+req.user.name,40,bottom,{width:width-90,lineBreak:false});doc.text(`${p+1} / ${range.count}`,doc.page.width-100,bottom,{width:60,align:'right',lineBreak:false})}doc.end();
}
