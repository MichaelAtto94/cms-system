export async function api(url,body,method='POST'){
 const response=await fetch('/api'+url,{method:body===undefined?'GET':method,headers:body instanceof FormData?{'X-CMS-Request':'1'}:{'Content-Type':'application/json','X-CMS-Request':'1'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
