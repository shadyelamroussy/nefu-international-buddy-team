const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");
const path=require("path");
const db=new Database(path.join(__dirname,"..","data","nefu.db"));

const admins=[
  {username:"shady",name:"Shady",email:"shadyelamroussy@gmail.com",phone:process.env.ADMIN1_PHONE||"0000000001",password:process.env.ADMIN1_PASSWORD},
  {username:"sargylana",name:"Sargylana",email:null,phone:process.env.ADMIN2_PHONE||"0000000002",password:process.env.ADMIN2_PASSWORD}
];

if(!admins[0].password || !admins[1].password){
  console.error("Set ADMIN1_PASSWORD and ADMIN2_PASSWORD before running this script.");
  process.exit(1);
}

(async()=>{
  const stmt=db.prepare(`INSERT INTO users(username,name,email,phone,password_hash,role,status)
    VALUES(?,?,?,?,?,'admin','active')
    ON CONFLICT(username) DO UPDATE SET name=excluded.name,email=excluded.email,phone=excluded.phone,password_hash=excluded.password_hash,role='admin',status='active'`);
  for(const a of admins){
    const hash=await bcrypt.hash(a.password,12);
    stmt.run(a.username,a.name,a.email,a.phone,hash);
  }
  console.log("Two admin accounts are ready: shady and sargylana");
})();
