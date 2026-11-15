/** Dotted IPv4 only; private, loopback, link-local, shared, documentation and multicast ranges are refused. */
export function publicIPv4(value:string):boolean{
 if(!/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value))return false
 const [a,b,c]=value.split('.').map(Number)
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)
}
