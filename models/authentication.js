const mongoose=require('mongoose');
const Schema=mongoose.Schema;
const passportLocalMongoose=require("passport-local-mongoose");

const AuthSchema=new Schema({
    email:{
        type:String,
        required:true,
        unique:true
    },
    notes:[{
        text:String,
        active:String,
        image:[{
            url:String,
            filename: String
        }],
    }],
    status:String,
})

AuthSchema.plugin(passportLocalMongoose);

module.exports=mongoose.model('Auth',AuthSchema);
