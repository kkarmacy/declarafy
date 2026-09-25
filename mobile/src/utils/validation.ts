export function isValidRuc(value:string){
 if(!/^\d{11}$/.test(value)) return false;
 const digits=value.split('').map(Number);
 const weights=[5,4,3,2,7,6,5,4,3,2];
 const sum=weights.reduce((acc,w,i)=>acc+w*digits[i],0);
 const remainder=11-(sum%11);
 const check=remainder===10?0:remainder===11?1:remainder;
 return check===digits[10];
}
export function isEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());}
