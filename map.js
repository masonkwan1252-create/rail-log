let map=L.map('map').setView([36.2,138],5)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
maxZoom:18
}).addTo(map)

let trips=JSON.parse(localStorage.getItem("railTrips")||"[]")

async function loadStations(){

let stations=await (await fetch("stations.json")).json()

let coords={}
stations.forEach(s=>{
coords[s.name]=[s.lat,s.lng]
})

drawTrips(coords)

}

function drawTrips(coords){

trips.forEach(t=>{

let a=coords[t.from]
let b=coords[t.to]

if(a && b){

L.polyline([a,b],{
weight:4
}).addTo(map)

}

})

}

loadStations()
