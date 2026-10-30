// JurisAI judgment-source navigation helper.
window.jurisSourceUrl=function(r){
  if(r&&r.demo)return "#judgment/"+encodeURIComponent(r.id);
  if(r&&typeof r.source_url==="string"&&/^https:\/\/indiankanoon\.org\/doc\/\d+\/?$/.test(r.source_url))return r.source_url;
  if(r&&/^\d+$/.test(String(r.id||"")))return "https://indiankanoon.org/doc/"+encodeURIComponent(r.id)+"/";
  if(r&&r.source_url&&r.source_url!=="#"&&!String(r.source_url).startsWith("#"))return r.source_url;
  return "#judgment/"+encodeURIComponent(r&&r.id||"");
};