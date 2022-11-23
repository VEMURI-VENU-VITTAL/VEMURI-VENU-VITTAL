if(process.env.NODE_ENV!=="production"){
  require('dotenv').config();
}

const express=require('express');
const app=express();
const mongoose=require('mongoose');
const ejsMate=require('ejs-mate');
const methodOverride=require('method-override');
const path=require('path');
const passport=require('passport');
const LocalStrategy=require('passport-local');
const session=require('express-session')
const flash=require('connect-flash');
const {isLoggedIn}=require('./middleware');
const multer=require('multer');
const {storage}=require('./cloudinary/app');
const upload=multer({storage})
const cloudinary=require('cloudinary').v2;
const streamifier=require('streamifier');
const ExpressError=require("./utils/ExpressError")
const catchAsync=require("./utils/catchAsync")
const helmet=require('helmet');
// const user = require('./models/user');
const Auth=require('./models/authentication')
const MongoDBStore=require("connect-mongo")(session);
const bcrypt=require('bcrypt');
const cookieParser=require('cookie-parser');
const nodemailer=require('nodemailer');
const cryptojs=require("crypto-js");

const dbUrl= process.env.DB_URL||'mongodb://localhost:27017/otp';
const secret= process.env.SECRET || 'thisshouldbeabettersecret';


main().catch(err => console.log(err));
async function main() {
    await mongoose.connect(dbUrl)
    .then(()=>{
      console.log("connection open");
      useNewUrlParser:true;
      useCreateIndex:true;
      useUnifiedTopology:true;
      useFindAndModify:false;
      
    })
    .catch(err=>{
      console.log("oh no error!!");
      console.log(err);
    })
  
    console.log("connected");
    
    // use `await mongoose.connect('mongodb://user:password@localhost:27017/test');` if your database has auth enabled
  }

app.set('views',path.join(__dirname,'views'));
app.engine('ejs',ejsMate);
app.set('view engine','ejs');
app.use(express.urlencoded({extended:true}))

const store = new MongoDBStore({
    url:dbUrl,
    secret,
    touchAfter:24*60*60
  
  })
  
  store.on("error",function(e){
    console.log('session store', e);
  })
  
  const sessionConfig={
      store,
      name:'session',
      secret,
      resave:false,
      saveUninitialized:true,
      cookie:{
        httpOnly:true,
        express:Date.now()+1000*60*60*24*7,
        maxAge:1000*60*60*24*7
      }
    }

app.use(session(sessionConfig))
app.use(cookieParser());
app.use(flash())
app.use(passport.initialize());
app.use(passport.session())
passport.use(new LocalStrategy(Auth.authenticate()));
passport.serializeUser(Auth.serializeUser());
passport.deserializeUser(Auth.deserializeUser());


app.use(methodOverride('_method'))

app.use((req,res,next)=>{
    res.locals.otp=req.cookies.otp;
    res.locals.currentUser=req.user;
    res.locals.success=req.flash("success");
    res.locals.error=req.flash('error');
    next();
})

const transporter=nodemailer.createTransport({
  service: 'gmail',
  auth:{
    user: 'ucs20435@rmd.ac.in',
    pass: 'Venutheprince'
  }
});

const mailOptions={
  from:'ucs20435@rmd.ac.in',
  to:'',
  subject: 'OTP verification from project user',
  text: 'We have received your request for the OTP. \n Here is your otp. '
};

function encrypt(a){
  let encrypteddata=cryptojs.AES.encrypt(a, secret).toString();
  return encrypteddata;
}

function decrypt(a){
  let bytes=cryptojs.AES.decrypt(a, secret);
  let decryptedemail=bytes.toString(cryptojs.enc.Utf8);
  return decryptedemail;
}

app.get('/',isLoggedIn,async (req,res)=>{
  const slips=await Auth.findById(req.user.id);
  for(let i=0;i<slips.notes.length;i++){
    slips.notes[i].text=decrypt(slips.notes[i].text);
  }
  const otp=req.cookies.otp;
  res.render('home.ejs',{slips,otp});
})

app.get('/generate/otp',isLoggedIn,async (req,res)=>{
  if(req.cookies.otp){
    res.clearCookie('otp');
  }
  const salt=await bcrypt.genSalt(10);
  const otp=Math.floor(Math.random()*(9999-1000)+1000);
  const hash=await bcrypt.hash(otp.toString(),salt);
  res.cookie('otp',hash,{
    maxAge:1000*10*60
  });
  
  const auth=await Auth.findById(req.user.id);
  mailOptions.to=auth.email;
  mailOptions.text+=otp.toString();
  transporter.sendMail(mailOptions, function(error,info){
    if(error){
      console.log(error);
    }
    else{
      console.log('Email sent: '+info.response);
    }
  })
  mailOptions.text='We have received your request for the OTP. \n Here is your otp. ';
  res.redirect('/');
})

app.post('/verify/otp', isLoggedIn,async (req,res)=>{
  const {otp}=req.body;
  if(otp){
    const result=await bcrypt.compare(otp.toString(),req.cookies.otp);
    const slip=await Auth.findById(req.user.id);
    if(slip.status=='pending'){
      slip.status='active';
      await slip.save();
    }
    else{
      if(result){
        for(let i=0;i<slip.notes.length;i++){
          if(slip.notes[i].active=='lock'){
            slip.notes[i].active='free';
          }
          await slip.save();
        }
      }
    }
    res.clearCookie('otp');
  }
  else{
    req.flash('error','CLICK UNLOCK OR YOUR OTP EXPIRES')
  }
  
  res.redirect('/');
})

app.get('/lock/:num',isLoggedIn,async (req,res)=>{
  const {num}=req.params;
  const auth=await Auth.findById(req.user.id);
  auth.notes[num].active='lock';
  await auth.save();
  res.redirect('/');
})

app.get('/lockall',isLoggedIn,async (req,res)=>{
  const auth=await Auth.findById(req.user.id);
  for(let i=0;i<auth.notes.length;i++){
    if(auth.notes[i].active=='free'){
      auth.notes[i].active='lock';
    }
  }
  await auth.save();
  res.redirect('/');
})

app.get('/addslip',isLoggedIn,(req,res)=>{
  res.render('add.ejs');
})

app.get('/slip/:num/edit', isLoggedIn, (req,res)=>{
  const {num}=req.params;
  const slip=req.user.notes[num];
  slip.text=decrypt(slip.text);
  for(let i=0;i<slip.image.length;i++){
    slip.image[i].url=decrypt(slip.image[i].url);
  }
  res.render('editslip.ejs', {slip,num});
})

app.patch('/editslip',upload.array('image'),isLoggedIn,async (req,res)=>{
  console.log(req.body.num);
  const {num,text,active}=req.body;
  const slip=await Auth.findById(req.user.id);
  
  try{
    for(let i=0;i<req.files.length;i++){
      const ne={
          url:encrypt(req.files[i].path),
          filename:req.files[i].filename
      }
      slip.notes[num].image.push(ne);
  }
  }
  catch{}
  
  slip.notes[num].text=encrypt(text);
  slip.notes[num].active=active;
  await slip.save();
  res.redirect('/');
})

app.get('/slip/:i/view', isLoggedIn, async(req,res)=>{
  const {i}=req.params;
  const auth=await Auth.findById(req.user.id);
  const notes=auth.notes[i];
  notes.text=decrypt(notes.text);
  for(let j=0;j<notes.image.length;j++){
    notes.image[j].url=decrypt(notes.image[j].url);
  }
  res.render('view.ejs',{auth,notes});
})

app.post('/addslip',upload.array('image'),isLoggedIn,async (req,res)=>{
  const {text,active}=req.body;
  const auth=await Auth.findById(req.user.id);
  const notes={};
  notes['image']=[];
  console.log(req.files);
  try{
    for(let i=0;i<req.files.length;i++){
      const ne={
          url:encrypt(req.files[i].path),
          filename:req.files[i].filename
      }
      notes['image'].push(ne);
  }
  }
  catch{}
  notes['text']=encrypt(text);
  notes['active']=active;
  auth.notes.push(notes);
  await auth.save();
  res.redirect('/');
})

// app.post('/slip/:num/addimg',upload.array('image'),async (req,res)=>{
//   const {num}=req.params;
//   const auth=await Auth.findById(req.user.id);
//   console.log(req.files);
//   for(let i=0;i<req.files.length;i++){
//     const ne={
//         url:req.files[i].path,
//         filename:req.files[i].filename
//     }
//     auth.notes[num].image.push(ne);
    
// }
// await auth.save();
// })

app.delete('/slip/:num/delete',isLoggedIn,async (req,res)=>{
  const {num}=req.body;
  const slip=await Auth.findById(req.user.id);
  slip.notes.pop(num);
  await slip.save();
  res.redirect('/');
})

app.delete('/slip/:num/:i/delete', isLoggedIn, async(req,res)=>{
  const {num,i}=req.params;
  const auth=await Auth.findById(req.user.id);
  auth.notes[num].image.splice(i,1);
  await auth.save();
  res.redirect(`/slip/${num}/edit`);
})

app.get('/register',(req,res)=>{
    res.render('register.ejs')
  })

  app.post('/register',async (req,res)=>{
    try{
    const {email,username,password}=req.body;
    const auth=await new Auth({email,username,status:'pending'});
    const registeredUser=await Auth.register(auth,password);
    req.login(registeredUser, err=>{
        if(err) return next(err);
        req.flash('success','successfully logged in!!')
        res.redirect('/');
    })
    }
    catch(e){
        req.flash('error',e.message)
        res.redirect('/');
    }
  })

  app.get('/login',(req,res)=>{
    res.clearCookie('otp');
    res.clearCookie('email');
    if(req.user){
      res.redirect('/');
    }
    res.render('login.ejs');
  })

  app.post('/login',passport.authenticate('local',{failureFlash:true, failureRedirect:'/login'}),(req,res)=>{
    req.flash('success','welcome back');
    const redirectUrl=req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(redirectUrl);
  })

  app.get('/logout',isLoggedIn,async (req,res)=>{
    const slip=await Auth.findById(req.user.id);
    for(let i=0;i<slip.notes.length;i++){
      if(slip.notes[i].active=='free'){
        slip.notes[i].active='lock';
      }
    }
    if(req.cookies.otp){
      res.clearCookie('otp');
    }
    await slip.save();
    req.logout(function(err) {
        if (err) { return next(err); }
        req.flash('success','logged out successfully');
        res.redirect('/login');
      });
    
  })

  app.get('/change/password/part2', (req,res)=>{
    if(req.cookies.otp && req.cookies.email){
      const email=req.cookies.email;
      res.render('change2.ejs',{email});
    }
    else{
      res.render('login.ejs');
    }
    
  })

  app.post('/change/password', async (req,res)=>{
    const salt=await bcrypt.genSalt(10);
    const otp=Math.floor(Math.random()*(9999-1000)+1000);
    const hash=await bcrypt.hash(otp.toString(),salt);
    res.cookie('otp',hash,{
      maxAge:1000*10*60
    });
    res.cookie('email', req.body.email,{
      maxAge:1000*10*60
    })
    
    const auth=await Auth.findOne({email:req.body.email});
    mailOptions.to=auth.email;
    mailOptions.text+=otp.toString();
    transporter.sendMail(mailOptions, function(error,info){
      if(error){
        console.log(error);
      }
      else{
        console.log('Email sent: '+info.response);
      }
    })
    mailOptions.text='Dont share otp to anyone, your otp is: ';
    res.redirect('/change/password/part2');
  })

  app.post('/change/password/part2',(req,res)=>{
    const {otp,email}=req.cookies;
    if(otp && email){
      if(bcrypt.compare(req.cookies.otp,otp)){
        res.cookie('email',email,{
          maxAge:1000*10*60,
        })
        req.flash('success','this form valid only 10 minutes');
        res.redirect('/change/password/part3');
      }
    }
    else{

      res.clearCookie('otp');
      res.clearCookie('email');
    }
    
  })
    
  app.get('/change/password/part1',(req,res)=>{
    res.render('change.ejs')
  })

  app.get('/change/password/part3',(req,res)=>{
    res.render('change3.ejs');
  })

  app.post('/change/password/part3',async (req,res)=>{
    const {password,newpassword}=req.body;
    // console.log(password);
    const user=await Auth.findOne({email:req.cookies.email});
    // console.log(user.password);
    // user.changePassword(user.password,password,function(err){
    //   if(err){
    //     res.send(err);
    //   }
    //   else{
    //     res.send("password changed");
    //   }
    // });
    if(password==newpassword){
      await user.setPassword(req.body.password);
      const updatedUser = await user.save();
      req.flash('success', 'Password Changed Successfully') 
      res.clearCookie('email');
      res.clearCookie('otp');
      res.redirect('/login') 
    }
    else{
      res.clearCookie('otp');
      res.clearCookie('email');
      req.flash('error','time expired!!')
      res.redirect('/login');
    }
  
  })

  app.all('*',(req,res,next)=>{
    next(new ExpressError('page not found',404))
  })

  app.use((err,req,res,next)=>{
    const {statusCode=500,message="something went wrong"}=err;
    res.status(statusCode).render('error.ejs',{err});
  })


const port=process.env.PORT || 3000;
  app.listen(port, ()=>{
    console.log(`serving on port ${port}!`);
})

