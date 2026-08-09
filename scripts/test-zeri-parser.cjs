
const z=require("../server/handlers/zeri-connections.js")._test;
const html=`<h1>Maestro di San Martino a Mensola, Madonna con Bambino e donatori</h1>
<h2>AUTORE</h2><div>Autore Maestro di San Martino a Mensola (Francesco di Michele?) [ ULAN ]
Motivazione dell'attribuzione Bibliografia</div>
<h2>ALTRE ATTRIBUZIONI</h2><div>Autore Giovanni del Biondo [ VIAF ] [ ULAN ] [ WIKIDATA ] [ WIKIPEDIA ]
Motivazione dell'attribuzione Nota dattiloscritta sul verso della fotografia</div><h2>Datazione</h2>`;
const text=z.stripHtml(html);
const alt=text.slice(text.indexOf("ALTRE ATTRIBUZIONI"),text.indexOf("Datazione"));
const authors=z.parseAuthors(alt);
if(!authors.some(x=>x.includes("Giovanni del Biondo"))) throw new Error("Failed to parse alternate attribution");
if(!z.titleFrom(html).includes("Maestro di San Martino")) throw new Error("Failed to parse work title");
console.log("PASS: Zeri alternate-attribution fixture");
