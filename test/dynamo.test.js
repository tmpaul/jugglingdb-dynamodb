var should = require('./init.js');

var User;

describe('dynamodb', function(){

    before(function() {
      db = getSchema();
      User = db.define('User', {
        id: { type: String, keyType: "hash", uuid: true},
        name: { type: String },
        email: { type: String },
        age: {type: Number},
        tasks: { type: String, properties: { breaker: 2} }
      });
    });

  beforeEach(function(done) {
    // Table creation is async. Wait 1.5s so that
    // table gets created.
    setTimeout(function() {
      done();
    }, 1500);
  });

  it('should create user without any errors', function (done) {
    var tempUser = new User({
      name: "John Doe",
      email: "john@doe.com",
      age: 20,
      tasks: "Blah blah blah"
    });
    User.create(tempUser, function (err, user) {
      should.not.exist(err);
      user.should.have.property('name', 'John Doe');
      user.should.have.property('tasks');
      // Make sure that chunked data is not sent back to
      // the user
      user.should.not.have.property('tasks-1');
      user.should.not.have.property('tasks-2');
      done();
    });
  });
  /*
    DynamoDB handles undefined entities by storing them as the string `undefined` and null fields
    as the string `null`. Please handle undefined and null fields in your code. Do not expect adapter
    to throw an error here.
   */
  it('should handle undefined and null attributes and return the same from database', function(done){
     var tempUser = new User({
      email: null,
      age: 20,
      tasks: "Blah blah blah"
    });
    User.create(tempUser, function (err, user) {
      should.not.exist(err);
      (user.email === null).should.be.true;
      done();
    });
  });
});