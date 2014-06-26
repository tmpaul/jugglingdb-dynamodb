var should = require('./init.js');

var db, User, Book, Cookie, Car;

describe('dynamodb', function(){

  before(function(done) {
    db = getSchema();
    User = db.define('User', {
      id: { type: String, keyType: "hash"},
      name: { type: String },
      email: { type: String },
      age: {type: Number},
      tasks: { type: String, sharding : true, splitter : "10kb"}
    });

    Book = db.define('Book', {
      id : { type: String, keyType: "pk", separator: "--oo--"},
      ida : { type: String, keyType: "hash"},
      subject : { type: String, keyType: "range"},
      essay : { type: String, sharding : true }
    }, {
      table: "book_test"
    });

    Cookie = db.define('Cookie', {
      color: {type: String},
      recipe: {type: String, sharding : true }
    });

    Car = db.define('Car', {
      doors: {type: Number},
      licensePlate: { type: String, keyType: "hash"}
    });

    var modelCount = 0;
    db.adapter.emitter.on("created", function(){
      modelCount++;
      // Tables for both models created in database.
      if (modelCount === 4) {
        Book.destroyAll(function(){
          Car.destroyAll(function(){
            Cookie.destroyAll(function(){
              User.destroyAll(done);
            });
          });
        });
      }
    });
  });

  beforeEach(function(done){
    Book.destroyAll(function(){
      Car.destroyAll(function(){
        Cookie.destroyAll(function(){
          User.destroyAll(done);
        });
      });
    });
  });

  describe('sharding', function() {

    // It should create table on model definition
    it("should create sharded table for User", function() {
      db.adapter.client.listTables(function (err, data){
        var existingTableNames = data.TableNames;
        var tableExists = false;
        // Table user_test and book_test are present. Check for sharded table
        existingTableNames.forEach(function (existingTableName) {
          if (existingTableName === 'User_tasks') {
            tableExists = true;
          }
        });
        tableExists.should.be.true;
      });
    });

    it("should have sharded table with hash key and range key", function(done){
      db.adapter.client.describeTable({TableName: "User_tasks"}, function (err, data){
        data.Table.AttributeDefinitions[0].AttributeName.should.eql("user#id");
        data.Table.AttributeDefinitions[1].AttributeName.should.eql("tasks#ID");
        done();
      });
    });

    it("should not create sharded table if sharding property is not set", function(done){
      db.adapter.client.describeTable({ TableName: "Book_subject"}, function(err, data){
        (data === null).should.be.true;
        done();
      });
    });

    it("should split by the size specified during sharding", function(done){
      db.adapter._models['User'].splitSizes[0].should.eql(10);
      done();
    });

    it("should split by default size of 63 kb if splitter is not specified", function(done){
      db.adapter._models['Cookie'].splitSizes[0].should.eql(63);
      done();
    });

    it('should write data to sharded table on save', function(done){
      var tempUser = new User({
        id: "1",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        user.tasks = "Plim Plum Pooh Popo Dara Dum Dee Dum";
        user.save(function(err, savedUser){
          should.not.exist(err);
          User.find("1", function(err, fetchedUser){
            fetchedUser.should.have.property('tasks', 'Plim Plum Pooh Popo Dara Dum Dee Dum');
            done();
          });
        });
      });
    });

    it('should handle empty values for breakable attribute', function(done){
      var tempUser = new User({
        id: "2",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: ""
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        (user.tasks === "").should.be.true;
        done();
      });
    });

    it('should handle null value for breakable attribute', function(done){
      var tempUser = new User({
        id: "2",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: null
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        (user.tasks === null).should.be.true;
        done();
      });
    });

    it('should handle undefined value for breakable attribute', function(done){
      var tempUser = new User({
        id: "2",
        name: "John Doe",
        email: "john@doe.com",
        age: 20
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        (user.tasks === undefined).should.be.true;
        done();
      });
    });

    it('should write data to sharded table on updateAttributes', function(done){
      var tempUser = new User({
        id: "2",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        user.updateAttributes({tasks: "Plim Plum Pooh Popo Dara Dum Dee Dum"}, function(err){
          should.not.exist(err);
          User.find("2", function(err, fetchedUser){
            fetchedUser.should.have.property('tasks', 'Plim Plum Pooh Popo Dara Dum Dee Dum');
            done();
          });
        });
      });
    });

    it('should destroy sharded table data on destruction of parent table data', function(done){
      var tempUser = new User({
        id: "2",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        user.destroy(function(err){
          db.adapter.client.scan({ TableName: "User_tasks"}, function(err, data){
            (data.Items).should.have.lengthOf(0);
            done();
          });
        });
      });
    });
  });


/*
 ONLY HASH KEYS
 */

  describe('if model only has a hash key', function() {

    it('should assign a hash key if not specified', function(done){
      Cookie.create({ color: "brown", recipe: "Bake it nice n soft" }, function(err, cookie){
        should.not.exist(err);
        cookie.should.have.property('id');
        db.adapter._models['Cookie'].hashKey.should.eql('id');
        db.adapter._models['Cookie'].hashKeyUUID.should.be.true;
        done();
      });
    });

    it('should throw error if uuid is true and attribute name is not id', function(done){
      (function() {
        db.define('Model', {
          attribute1 : { type: String, keyType: "hash", uuid: true},
        });
      }).should.throw();
      done();
    });

    it('should should fetch based on hash key', function(done){
      User.find("1", function(err, user){
        should.not.exist(err);
        should.exist.user;
        done();
      });
    });

    it('should assign same value as hash key to id attribute', function(done){
      Car.create({licensePlate: "XXYY-112", doors: 4}, function(err, car){
        should.not.exist(err);
        should.exist(car);
        car.should.have.property('id','XXYY-112');
        done();
      });
    });

    it('should create user with given hash key', function (done) {
      var tempUser = new User({
        id: "1",
        name: "John Doe",
        email: "john@doe.com",
        age: 20,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        user.should.have.property('id');
        user.should.have.property('name', 'John Doe');
        user.should.have.property('tasks');
        done();
      });
    });

    it('should replace original record if same hash key is provided', function(done){
      var tempUser = new User({
        id: "1",
        name: "Johnny Doey",
        email: "johnny@doey.com",
        age: 21,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        user.should.have.property('id', '1');
        user.should.have.property('name', 'Johnny Doey');
        user.should.have.property('age', 21);
        done();
      });
    });
  

    /*
      DynamoDB handles undefined entities by storing them as the string `undefined` and null fields
      as the string `null`. Please handle undefined and null fields in your code. Do not expect adapter
      to throw an error here.
     */
    it('should handle undefined and null attributes and return the same from database', function (done) {
      var tempUser = new User({
        id: "2",
        email: null,
        age: null,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        should.not.exist(err);
        (user.dob === undefined).should.be.true;
        (user.age === null).should.be.true;
        (user.email === null).should.be.true;
        done();
      });
    });

    // Null hash keys are not allowed
    it('should return error saying hash key cannot be null', function (done) {
      var tempUser = new User({
        id: null,
        email: null,
        age: null,
        tasks: "Blah blah blah"
      });
      User.create(tempUser, function (err, user) {
        should.exist(err);
        done();
      });
    });
  });


/*
  BOTH HASH AND RANGE KEYS
 */

  describe('if model has hash and range keys', function(){

    it('should use separator specified in schema definition', function(done){
      var book = new Book({
        ida: "abcd",
        subject: "Nature"
      });
      Book.create(book, function (err, _book){
        _book.should.have.property('id','abcd--oo--Nature');
        done();
      });
    });

    it('should throw error id attribute is missing', function(done){
      (function() {
          db.define('Model', {
          attribute1 : { type: String, keyType: "hash"},
          attribute2 : { type: Number, keyType: "range"}
        });
      }).should.throw();
      done();
    });

    it('should find objects with id attribute', function(done){
      var book = new Book({
        ida: "bca",
        subject: "Wildlife"
      });
      Book.create(book, function (e, b){
        Book.find(b.id, function (err, fetchedBook){
          fetchedBook.ida.should.eql("bca");
          fetchedBook.subject.should.eql("Wildlife");
          done();
        });
      });
    });

    it('should handle breakable attribute for hash and range key combination', function(done){
      var book = new Book({
        ida: "abc",
        subject : "Freaky",
        essay : "He's dead Jim."
      });
      Book.create(book, function(e, b){
        should.not.exist(e);
        Book.find(b.id, function(err, fetchedBook){
          fetchedBook.essay.should.eql("He's dead Jim.");
          fetchedBook.ida.should.eql("abc");
          fetchedBook.subject.should.eql("Freaky");
          done();
        });
      });
    });
    
    // Check if rangekey is supported
    it('should create two books for same id but different subjects', function (done) {
      var book1 = new Book({
        ida: "abcd",
        subject: "Nature"
      });

      var book2 = new Book({
        ida: "abcd",
        subject: "Fiction"
      });

      Book.create(book1, function (err, _book1) {
        should.not.exist(err);
        should.exist(_book1);
        _book1.should.have.property('ida', 'abcd');
        _book1.should.have.property('subject', 'Nature');

        Book.create(book2, function (err, _book2) {
          should.not.exist(err);
          should.exist(_book2);
          _book2.should.have.property('ida', 'abcd');
          _book2.should.have.property('subject', 'Fiction');
          done();
        });
      });
    });
  });

  after(function(done){
    db.adapter.client.deleteTable({TableName: 'User'}, function(){
      db.adapter.client.deleteTable({TableName: 'Car'}, function(){
        db.adapter.client.deleteTable({TableName: 'book_test'}, function(){
          db.adapter.client.deleteTable({TableName: 'Cookie'}, function(){
            done();
          });
        });
      });
    });
  });
});