var request = require('request');

request({
  uri: 'https://api1.mail.zen.ci/register',
  method: 'POST',
  body: '{}'
},function(err, response, body){
  console.log(err, response, body)
})