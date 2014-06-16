##JugglingDB Adapter for DynamoDB version 0.1.8-2
* Adapter is still in development stage. The stable release will be 0.2.0 and will offer rich functionalities along
with lots of tests.
* Always use the latest version of this adapter, preferably >= 0.1.5. The latest version has more features and lots of bug fixes. Versions
0.1.5 and below have serious limitations when it comes to real world applications.
* If you run across any errors while running the adapter, kindly report issues in the github repository.
* Github repository: <a href = "https://github.com/tmpaul/jugglingdb-dynamodb">jugglingdb-dynamodb</a>
* Dependencies : `aws-sdk`, `colors`, `async`, `winston`.
* Installation:
    `npm install jugglingdb-dynamodb`


### Using the adapter with DynamoDB Local
* During the testing/development phase of your application's lifecycle, it is a good idea to use DynamoDB local. DynamoDB local is a java archive file that runs on your machine, and it does a very good job at mocking the original database. Download the file <a href = "http://dynamodb-local.s3-website-us-west-2.amazonaws.com/dynamodb_local_latest">here.</a>
* To run DynamoDB Local, use this command from the terminal in the directory where you extracted the tar file: `java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar [options]`

#### Options: 
* -port port_number (8000 by default) 
* --inMemory (Run in memory).

### Using the adapter with DynamoDB remote
* Put your AWS access key and secret access key IDs along with the region in `credentials.json` in the root folder of your app. For example, 
```javascript
{ 
  "accessKeyId": "xxxxxxxxxxxxxx", 
  "secretAccessKey": "xxxxxxxxxxxxxxxxxx", 
  "region": "us-east-1" 
}
```
If this file is missing, the adapter will try to read host, port , IDs and key from the values you pass in the schema/model file. See below for an example.

### Schema/Model file (DynamoDB Local)
```javascript
    var dynSettings = {
      host: "localhost",
      port:"8000", 
      accessKeyId: "mykey",
      secretAccessKey:"secret"
    };
```

####Options:
- host: Address of the dynamodb server. Defaults to "localhost".
- port: Port number of the dynamodb server. Defaults to "8000".
- region: DynamoDB server region. Defaults to "ap-southeast-1".
- accessKeyId: Your access key id. Defaults to "fake".
- secretAccessKey: Your secret access key. Defaults to "fake".
- maxRetries: Number of connection retries. Defaults to 0.
- logLevel : Log level. Defaults to "debug".

####Model Definition
```javascript
    var Schema = require('jugglingdb').Schema;
    var schemaDynamo = new Schema('dynamodb', dynSettings);

    var User = schemaDynamo.define('User', {
      id : { type: String, keyType: "hash", uuid: true},
      name: { type: String },
      age: { type: Number},
      isDead: { type: Boolean},
      DOB: { type: Date, keyType: "range"},
      tasks: { type: String, sharding : true, splitter : "60kb"}
    }, {
      table : "User"
    });
```

### Schema/Model file (DynamoDB Remote)
- Settings are loaded by adapter from `credentials.json`.

####Model Definition
```javascript
    var Schema = require('jugglingdb').Schema;
    var schemaDynamo = new Schema('dynamodb'); // No dynSettings needed.

    var User = schemaDynamo.define('User', {
      id : { type: String, keyType: "hash", uuid: true},
      name: { type: String },
      age: { type: Number},
      isDead: { type: Boolean},
      DOB: { type: Date, keyType: "range"},
      tasks: { type: String, sharding : true, splitter : "60kb"}
    }, {
      table : "User",
      ReadCapacityUnits : 15,
      WriteCapacityUnits: 20
    });
```

###Explanation
- DynamoDB stores information in the form of tables. Each table has a collection of items. Think of items as a row in a table. Each
item in turn is a collection of attributes. Each attribute is stored in the database as a key:value pair.

####Key Schema

- DynamoDB primary key is a composite key consiting of a hash key and a range key. For a given item in the table, the key schema can specify one hash key or one hash key and a range key.

- To specify a given attribute as hash key, use `keyType: "hash"` along with its definition as shown in the above example.

- DynamoDB expects a hash key for every item that is created. If this value is not available at the time of creation, there is an option to use a UUID generator to generate the hash key. To use this option, specify `uuid: true` in the model definition.

- Similarly, attribute becomes a range key if keyType is set to "range".


###USAGE

#####HASH KEY ONLY

- If a model only has a hash key, any attribute can be specified as the hash key. However, if `uuid` is set to `true`, then the attribute name
must be `id`. This restriction comes from JugglingDB.

- If you forget to include a hash key for the model, automatically an attribute called `id` is generated with `uuid` set to `true`.

- If no unique ID generation is present, the value of the hash key must be provided at the time of creating an item in the table. In this case, the attribute name can be anything; not just `id`.

```javascript
    var User = schemaDynamo.define('User', {
    someId : { type: String, keyType: "hash", uuid: true} .... 
        //Not allowed

    var User = schemaDynamo.define('User', {
    someId : { type: String, keyType: "hash"}, .....
        // Allowed
```

#####HASH & RANGE KEYS

- If a model has both hash & range keys, a primary key attribute called `id` must be present in the table. The attribute name cannot be anything else other than `id`, or the adapter will throw an error. Unlike the above given case, `id` attribute does not get created for the object.

- The primary key must be defined as follows:
```javascript
    var User = schemaDynamo.define('User', {
    id : { type: String, keyType: "pk", separator : "--oo--"},
    companyId : { type: Number, keyType: "hash"},
    name: { type: String },
    age: { type: Number , keyType: "range"},....
    ....
```
- The separator is used to define the primary key based on the hash and range keys. If the hash key is `1` and the range key is `xyz`, then according to the above example, the primary key `id` will be `1--oo--xyz`. Any random separator can be used to store the primary key, but make sure that you do not include separators like `###` or  `?`. These separators might cause problems in the view pages of the model, wherein they will be interpreted as part of the url. The default separator is `--x--`.

- The important thing to note is that the primary key is purely a virtual attribute to identify a particular item. It does not get persisted in the database.

#####DATATYPES
- DynamoDB supports only String, Binary, and Number datatypes along with their corresponding Sets.
- The adapter currently supports String, Number, Date and Boolean datatypes.
- Null, undefined and empty strings are handled by the adapter. However, invalid date or missing numbers might cause
DynamoDB to throw an error.
- Date is stored internally as a number, and boolean is stored as a string => `true` or `false`.

#####READ/ WRITE CAPCACITY UNITS
- Provisioned Throughput for each table can be specified by using the `set` property function of Jugglingdb. In the above example, the
read and write capacity units are set for `User`.
- The defaults for read and write capacity units are 5 and 10 respectively.

#####DATABASE LIMITATIONS
- DynamoDB has an item size limit of 64 kb. Typically data is stored in the form of big strings in NoSQL tables (e.g objects with complex data structures). Eventually these strings might exceed 64 kb in size. To overcome this limitation, the adapter uses a sharding technique. Sharding is done if `sharding` is set to `true` in the model property.

```javascript
     tasks: { type: String, sharding : true, splitter : "63kb"}
```

- When an attribute is being sharded, the attribute is separated from the parent table, and is stored in a different (child) table. According to the example above, tasks attribute will be stored in a new table called `User_tasks`. The primary key of User table `id`, is stored in the new table as `user#id`, and a new range key is assigned for every chunk that exceeds a given size. So if `splitter` is set to 60 kb, and the tasks string exceeds 60 kb, the structure of child table will be as shown below:

```
    {
      user#id: { "S" : "xxxxyyyyy" },
      tasks#ID: { "N" : "1" },
      tasks: { "S" : "This attribute has been broken" }
    }
    
    {
      user#id: { "S" : "xxxxyyyyy" },
      tasks#ID: { "N" : "2" },
      tasks: { "S" : "down into two different pieces" }
    }
```
- The value of `splitter` can be anywhere from 1 to 63 kb. This is to make sure that there is enough room to store the primary key of parent table and the range key in the child table. 

- The attribute value (String) is broken down based on the size specified by the `splitter` attribute. For example, in the above given model definition, the tasks string is broken down into 60 kb chunks. Each chunk is stored as a new item with a range key and the primary key of parent item.

- Due to the large size of items being retrieved/written to the child tables, these tables require more read and write capacity compared to the original table. Read and write capacities for the child table can be specified as follows:
```javascript
     tasks: { type: String, sharding : true, splitter : "63kb" , read : 15, write: 20}
```
- If read and write are not specified, the read / write capacities of the parent table is used.

- When the main item is being retrieved from the database, the adapter queries each child table, and builds back the string. As a result, the data structure is still intact after retrieval.

###CRUD OPERATIONS

####Create
```javascript
    
    // Only hash key
    
    User = db.define('User', {
      email: { type: String, keyType: "hash"},
      name: { type: String }
    });
    
    // Both hash and range keys
    
    Book = db.define('Book', {
      id : { type: String, keyType: "pk"},
      title : { type: String, keyType: "hash"},
      subject : { type: String, keyType: "range"},
    });
    
    var user = new User();
    var book = new Book();
    
    user.email = "john@doe.com";
    user.name = "John Doe";
    
    /* Note that book's `id` is not specified. `id` being
    a primary key is automatically created from the hash and range keys:
    title and subject
    */
    
    book.title = "A Lost Cause";
    book.subject = "Fiction";
    
    User.create(user, function(err, _user) {
    .....
    console.log(_user);
    /*
    {
      id : "john@doe.com",
      // Note that id is set to the same value as hashKey. This ensures that views don't break
      email: "john@doe.com",
      name: "John Doe",
    }
    */
    });
    
    Book.create(book, function(err, _book) {
    ...
    console.log(_book);
    /*
    {
      id : "A Lost Cause--x--Fiction", // Value is simply returned by create. It does not exist in database.
      title: "A Lost Cause",
      subject: "Fiction"
    }
    */
    });
```
####Find
```javascript
    var id = "0e203f96-8edc-437a-b1f0-625a584a49bd";
    User.find(id, function (err, user) {
    .....
    ...
    });
```

####All
- All method internally uses `query` operation if hash , hash/range keys are provided. Otherwise it will use `scan` operation. Both operations are limited to a result set size of 1 mb by DynamoDB. 
- To overcome this limitation , the adapter uses an async doWhilst loop to continuously fetch data. Therefore, be careful while using all, especially if you have large datasets.
- An upcoming version will include an iterator which will allow you to fetch data in batches.

```javascript
    User.all({
      where : {
        age : { gt : 20 }  
        /*
        or age : { between : [10,20] } - Between
        or age : { eq : 20 }    - Equal to
        or age : [10,20]     - In range 10 to 20
        or age : { le : 35}  - Less than or equal to
        */
      }
    }, function(err, users){
    .....
    });
```

####UpdateAttributes
```javascript
    
    // Model instance.updateAttributes(...)
    
    user.updateAttributes({name : "No Name"}, function(err, updatedUser){
    .....
    });
```
####Save
- If the object does not exist in the database, invoking save will call `create` method first.

```javascript
    user.save(function(err, savedUser){
    .....
    });
```
####Destroy
```javascript
    user.destroy(function(err){
    .....
    });
```

####Upcoming features
- Support for `limit`, `order` keywords in query filters.
- Event emitters to notify that table has been created & is active.
- Support for Sets.
- Custom logging.

####Bugs, Features, Enhancements etc.
- The adapter is still in its development stage, and as a result the functionality is still lacking in some areas & few bugs are expected. Please create issues in the github repository to address these. Also please try to include a test case or error log if you are reporting a bug. Good luck!