const express = require('express');
const path = require('path');
const PORT = process.env.PORT || 5000;
const mysql = require('mysql')
const { auth } = require('express-openid-connect');
const app = express();
const bodyParser = require('body-parser');
const url = require('url');
const date = require('date-and-time');
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
const schedule = require('node-schedule');
const env = process.env.NODE_ENV;






Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({
      app,
    }),
  ],
  tracesSampleRate: 1.0,
});
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());
app.use(Sentry.Handlers.errorHandler());

/** Auth0 config */
const config = {
  authRequired: true,
  auth0Logout: true,
  secret: process.env.AUTH_SECRET,
  baseURL: (env === 'production' ? process.env.PROD_BASE_URL : process.env.DEV_BASE_URL),
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: process.env.ISSUER_BASE_URL
};


/** Helper functions */

class database {
  constructor( config ) {
      this.connection = mysql.createConnection(process.env.JAWSDB_URL );
  }
  query( sql, args ) {
      return new Promise( ( resolve, reject ) => {
          this.connection.query( sql, args, ( err, rows ) => {
              if ( err )
                  return reject( err );
              resolve( rows );
          } );
      } );
  }
  close() {
      return new Promise( ( resolve, reject ) => {
          this.connection.end( err => {
              if ( err )
                  return reject( err );
              resolve();
          } );
      } );
  }
};

/** TWILIO */
if (env === 'production') {
  const job = schedule.scheduleJob('52 13 * * *', function(){
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
      connection.connect();
      var findAssignedTasksQuery = `SELECT ast.id, pp.username as username, tst.category, tst.name as taskTypeName, t.name as taskName, l.name as locationName, p.firstName as personName, 
      tty.name as targetTypeName, tgt.name as targetName, st.\`type\` as scheduleType, st.dueDate, st.timeOfDay FROM assignedTask ast join scheduledtask st on ast.scheduledTask = st.id 
      join task t ON t.id = st.task JOIN tasktype tst ON tst.id = t.\`type\` JOIN tasktarget tsgt ON t.id = tsgt.task JOIN target tgt ON tsgt.target = tgt.id JOIN targettype tty ON tgt.\`type\` = tty.id 
      JOIN location l ON tgt.location = l.id left JOIN person p ON tgt.person = p.id left join person pp on ast.person = pp.id WHERE  complete = 0 and st.dueDate <= date(curdate() + interval 6 hour)  order by st.dueDate asc`;
      connection.query(findAssignedTasksQuery, function(err, rows, fields) {
        if (err) throw err;
        let due = [];
          if (Array.isArray(rows)){
            rows.forEach(element => {
              due.push(element.taskName);
            });
          } else {
              due.push(rows.taskName);
          }
          if (due != null && due != undefined && due != '') {
            var message = `"${Array.isArray(due) ? due.join("\", \"") : due}" is due today.`;//TODO: Beef out this message.
            process.env.TO_NUMBER.split(',').forEach(num => {
              twilio.messages.create({
                body: message,
                from: process.env.FROM_NUMBER,
                to: num
              }).then(message => console.log(message.body));
            });
          }
        }
      );
      connection.end();
  });
}


/** FORCE SSL */

var forceSsl = function (req, res, next) {
  if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(['https://', req.get('Host'), req.url].join(''));
  }
  return next();
};

/** APP */

if (env === 'production') {
  app.use(forceSsl);
}
//TODO: Add checks to every POST to make sure things are not empty, sanitize everything, too.
app
  .use(express.static(path.join(__dirname, 'public')))
  .use(auth(config))
  .use(bodyParser.urlencoded({extended : true}))
  .use(bodyParser.json())
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .set('trust proxy', true)
  .get('/', (req, res) => {
    res.render('pages/index');
  })
  .get('/management', (req, res) => {
     res.render('pages/management');
 })
 /**
  * Task Tracking
  */
 .get('/trackChores', (req,res) => {
   res.render('pages/trackTasks');
 })
 .post('/completeTasks', (req,res) => {
    let complete = url.parse(req.url, true).query.complete;
    var ids = [];
    if (Array.isArray(req.body.assignedTask)){
      req.body.assignedTask.forEach(element => {
        ids.push(element);
      });
    } else {
      ids.push(req.body.assignedTask);
    }
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    connection.query( `update assignedTask set complete = ${complete} where assignedTask.id in (${ids})`);
    connection.end();

    if (complete == 1) {
      let db = new database;
      let oldRows, newRows;
      let completed = [];
      db.query( `SELECT st.task, t.name, st.\`type\`, st.dueDate, st.timeOfDay, ast.person from assignedTask ast join scheduledTask st on ast.scheduledTask = st.id join task t on st.task = t.id where ast.id in (${ids}) and st.\`type\` != 'STANDALONE'`)
      .then( rows => {
         oldRows = rows;
         insertValues = [];
         let newDate = new Date();
         if (Array.isArray(rows)){
          rows.forEach(element => {
            if (element.type == 'DAILY') {
              newDate = date.addDays(new Date(element.dueDate), 1);
            } else if (element.type == 'WEEKLY') {
              newDate = date.addDays(new Date(element.dueDate), 7);
            } else if (element.type == 'MONTHLY') {
              newDate = date.addMonths(new Date(element.dueDate), 1);
            } else if (element.type == 'YEARLY') {
              newDate = date.addYears(new Date(element.dueDate), 1);
            }
            while (newDate < new Date()) {
              if (element.type == 'DAILY') {
                newDate = date.addDays(newDate, 1);
              } else if (element.type == 'WEEKLY') {
                newDate = date.addDays(newDate, 7);
              } else if (element.type == 'MONTHLY') {
                newDate = date.addMonths(newDate, 1);
              } else if (element.type == 'YEARLY') {
                newDate = date.addYears(newDate, 1);
              }
            }
            completed.push(element.name);
            insertValues.push([element.task, element.type, element.timeOfDay, newDate]);
          });
         } else {
             if (rows.type == 'DAILY') {
              newDate = date.addDays(new Date(rows.dueDate), 1);
             } else if (rows.type == 'WEEKLY') {
              newDate = date.addDays(new Date(rows.dueDate), 7);
             } else if (rows.type == 'MONTHLY') {
              newDate = date.addMonths(new Date(rows.dueDate), 1);
             } else if (rows.type == 'YEARLY') {
              newDate = date.addYears(new Date(rows.dueDate), 1);
             }
             completed.push(rows.name);
             insertValues.push([rows.task, rows.type, rows.timeOfDay, newDate]);
         }
          let insert = `insert into scheduledTask (task, type, timeOfDay, dueDate) values ?`;
          return db.query({
            sql: insert,
            values: [insertValues]
            });
      } ).then( rows => {
        newRows = rows;
        let insertValues = [], personIds = [], j=0;
        if (Array.isArray(oldRows)){
          oldRows.forEach(element => {
            personIds.push((element.person ? element.person : null));
          });
         } else {
          personIds.push((oldRows.person ? oldRows.person : null));
         }
        for (var i = rows.insertId; i < rows.insertId + rows.affectedRows; i++) {
          insertValues.push([i, personIds[j]])
          j++;
        }
        let insert = `insert into assignedTask (scheduledTask, person) values ?`;
          return db.query({
            sql: insert,
            values: [insertValues]
            });
      }).then(rows =>{
        if (env === 'production') {
          var message = `"${Array.isArray(completed) ? completed.join("\", \"") : completed}" has been marked complete on ${new Date(new Date().setHours((new Date().getHours() -6)))}`;
          process.env.TO_NUMBER.split(',').forEach(num => {
            twilio.messages.create({
              body: message,
              from: process.env.FROM_NUMBER,
              to: num
            }).then(message => console.log(message.body));
          });
        }
       });
    }
    res.status(200);
    res.redirect('/');
  })
  .get('/delete/:table/:id', function (req, res) {
     let id = req.params.id;
     let table = req.params.table;
     var connection = mysql.createConnection(process.env.JAWSDB_URL);
     connection.connect();
     var update = `delete from ${table} where id = ${id} `;
     connection.query(update, function(err, rows, fields) {
       if (err) throw err;
       console.log("1 record deleted");
     });
     connection.end();
     res.status(200);
     res.redirect('/management');
  })
  /**
  * Task Workflow
  */
  .get('/workflow', (req,res) => {
    res.render('pages/workflow');
  })
  .post('/workflow', async (req,res) => {
    if (req.body.taskType != null && req.body.taskType != '' && req.body.taskDescription != null && req.body.taskDescription != ''
    && req.body.scheduleType != null && req.body.scheduleType != '' && req.body.scheduleDate != null && req.body.scheduleDate != '') {
      //all good.
      
      let scheduleDate = new Date(req.body.scheduleDate);
      let taskRow, scheduledTaskRow;
      let db = new database;
      db.query( `insert into task (type, name) values ('${req.body.taskType}','${req.body.taskDescription}')` )
      .then( rows => {
          taskRow = rows;
          return db.query(`insert into taskTarget (task, target) values (${rows.insertId},${req.body.taskTargetTarget})`);
      } )
      .then(rows => {
          var scheduleInsert = `insert into scheduledTask (task, type, timeOfDay, dueDate) values (${taskRow.insertId}, '${req.body.scheduleType}', STR_TO_DATE('${req.body.scheduleTime}','%k:%i'), '${scheduleDate.toISOString()}')`;
          return db.query(scheduleInsert);
      } )
      .then( rows => {
        if (req.body.assignPerson != null && req.body.assignPerson != '') {
          scheduledTaskRow = rows;
          if (req.body.assignPerson != null && req.body.assignPerson != '') {
            return db.query(`insert into assignedTask (scheduledTask, person) values (${scheduledTaskRow.insertId},${req.body.assignPerson})`);
          } else {
            return db.query(`insert into assignedTask (scheduledTask) values (${scheduledTaskRow.insertId})`);
          }
        }
      } )
      .then(rows => {
          return db.close();
      } )
      .then( () => {
          //console.log(taskRow + " kazoo " + scheduledTaskRow);
      } );
      
      res.status(200);
      res.redirect('/workflow');
    } else {
      res.redirect('/workflow?error=true');
    }
  })
 /**
  * Assigned Task
  */
  .get('/assignedTasks', (req,res) => {
    let taskTypeCategory = url.parse(req.url, true).query.type;
    let complete = url.parse(req.url, true).query.complete;
    let byUser = url.parse(req.url, true).query.byUser;
    
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findAssignedTasksQuery = `SELECT ast.id, pp.firstName as username, tst.category, tst.name as taskTypeName, t.name as taskName, l.name as locationName, p.firstName as personName,
     tty.name as targetTypeName, tgt.name as targetName, st.\`type\` as scheduleType, st.dueDate, st.timeOfDay FROM assignedTask ast join scheduledtask st on ast.scheduledTask = st.id join task t
      ON t.id = st.task JOIN tasktype tst ON tst.id = t.\`type\` JOIN tasktarget tsgt ON t.id = tsgt.task JOIN target tgt ON tsgt.target = tgt.id JOIN targettype tty ON tgt.\`type\` = tty.id JOIN location l ON tgt.location = l.id left
       JOIN person p ON tgt.person = p.id left join person pp on ast.person = pp.id WHERE  tst.category = '${taskTypeCategory}' and complete = ${complete} `;
    if (byUser != null && byUser == 'true') {
      findAssignedTasksQuery = findAssignedTasksQuery.concat(` and pp.username = '${req.oidc.user.email}'`);
    }
    findAssignedTasksQuery = findAssignedTasksQuery.concat(`order by st.dueDate asc`);
    connection.query(findAssignedTasksQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/assignedTasks', function (req, res) {
    var inserts = [];
    let statement;
    if (req.body.assignPerson != null && req.body.assignPerson != '') {
      if (Array.isArray(req.body.unassignedTask)){
        req.body.unassignedTask.forEach(element => {
          inserts.push([element, req.body.assignPerson]);
        });
      } else {
        inserts.push([req.body.unassignedTask, req.body.assignPerson]);
      }
      statement = 'INSERT into assignedTask (scheduledTask, person) VALUES ?';
    } else {
      if (Array.isArray(req.body.unassignedTask)){
        req.body.unassignedTask.forEach(element => {
          inserts.push([element]);
        });
      } else {
        inserts.push([req.body.unassignedTask]);
      }
      statement = 'INSERT into assignedTask (scheduledTask) VALUES ?';
    }
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    connection.query({
      sql: statement,
      values: [inserts]
      });
    connection.end();
    
    res.status(200);
    res.redirect('/');
 })
 .get('/unassignTask/:id', function (req, res) {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `delete from assignedtask where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record deleted");
    });
    connection.end();
    res.status(200);
    res.redirect('/');
 })
  /** 
   * Person
   */
   .get('/persons', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findPersonsQuery = `select * from person p`
    connection.query(findPersonsQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
   .get('/person', (req, res) => {
      res.render('forms/person');
  })
   .post('/person', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into person (firstName, lastName, birthdate, username) values ('${req.body.firstName}','${req.body.lastName}','${req.body.birthdate}','${req.body.email}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/person/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from person t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {person: rows[0]});
    });
    connection.end();
  })
  .post('/person/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update person set firstName = '${req.body.firstName}', lastName = '${req.body.lastName}', birthdate = '${req.body.birthdate}', username = '${req.body.email}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * TaskType
   */
  .get('/taskType', (req, res) => {
    res.render('forms/taskType');
  })
  .get('/taskTypes', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTaskTypesQuery = `select * from taskType t`
    connection.query(findTaskTypesQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .get('/taskTypeCategories', (req, res) => {
    res.json({categories: ['CHORE','BILL','APPOINTMENT','OTHER']});
  })
  .post('/taskType', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into taskType (category, name) values ('${req.body.taskTypeCategory}','${req.body.taskTypeDescription}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/taskType/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTaskQuery = `select * from taskType t where t.id = ${id}`
    connection.query(findTaskQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {taskType: rows[0]});
    });
    connection.end();
  })
  .post('/taskType/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update taskType set category = '${req.body.taskTypeCategory}', name = '${req.body.taskTypeDescription}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /** 
   * Task 
   * */
  .get('/task', (req, res) => {
    res.render('forms/task');
  })
  .get('/task/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTaskQuery = `select * from task t where t.id = ${id}`
    connection.query(findTaskQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {task: rows[0]});
    });
    connection.end();
  })
  .post('/task/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update task set type = '${req.body.taskType}', name = '${req.body.taskDescription}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  .post('/task', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into task (type, name) values ('${req.body.taskType}','${req.body.taskDescription}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/tasks', (req, res) => {
    let notInTable = url.parse(req.url, true).query.notInTable;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTasksQuery = `select t.id, t.name, t.type, tt.name as typeName from task t join taskType tt on t.type = tt.id`
    if (notInTable != null && notInTable != '') {
      findTasksQuery = findTasksQuery.concat(` where t.id not in (select nit.task from ${notInTable} nit)`);
    }
    connection.query(findTasksQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  /**
   * Scheduled Tasks
   */
  .get('/scheduledTasks', (req,res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `SELECT st.id, st.dueDate, tst.category, tst.name as taskTypeName, t.name as taskName, l.name as locationName, p.firstName as personName, 
    tty.name as targetTypeName, tgt.name as targetName, st.\`type\` as scheduleType, st.timeOfDay FROM scheduledtask st JOIN task t ON t.id = st.task 
    JOIN tasktype tst ON tst.id = t.\`type\` LEFT JOIN tasktarget tsgt ON t.id = tsgt.task JOIN target tgt ON tsgt.target = tgt.id 
    JOIN targettype tty ON tgt.\`type\` = tty.id JOIN location l ON tgt.location = l.id left JOIN person p ON tgt.person = p.id WHERE st.id
     NOT IN (SELECT scheduledtask FROM assignedtask)`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .get('/scheduledTask', (req, res) => {
    res.render('forms/taskSchedule');
  })
  .get('/scheduleTypes', (req, res) => {
    res.json(['YEARLY','MONTHLY','WEEKLY','DAILY','STANDALONE']);
  })
  .post('/taskSchedule', function (req, res) {
    var scheduleDate = new Date(req.body.scheduleDate);
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into scheduledTask (task, type, timeOfDay, dueDate) values (${req.body.scheduleTask}, '${req.body.scheduleType}', STR_TO_DATE('${req.body.scheduleTime}','%k:%i'), '${new Date(req.body.scheduleDate).toISOString()}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
      
    });
    connection.end();
    res.status(200);
    res.redirect('/management');
  })
  .get('/scheduledTask/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from scheduledTask t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {scheduledTask: rows[0]});
    });
    connection.end();
  })
  .post('/taskSchedule/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update scheduledTask set task = '${req.body.scheduleTask}', type = '${req.body.scheduleType}', timeOfDay = STR_TO_DATE('${req.body.scheduleTime}','%k:%i'), dueDate = '${new Date(req.body.scheduleDate).toISOString()}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
  })
  .get('/unschedule/:id', function (req, res) {
     let id = req.params.id;
     var connection = mysql.createConnection(process.env.JAWSDB_URL);
     connection.connect();
     var update = `delete from scheduledTask where id = ${id} `;
     connection.query(update, function(err, rows, fields) {
       if (err) throw err;
       console.log("1 record deleted");
     });
     connection.end();
     res.status(200);
     res.redirect('/');
  })
  /**
   * Location
   */
   .get('/locations', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findLocationsQuery = `select * from location l`
    connection.query(findLocationsQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/location', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into location (name, inHouse) values ('${req.body.locationName}','${req.body.inHouseLocation ? 1 : 0}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/location/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from location t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {location: rows[0]});
    });
    connection.end();
  })
  .post('/location/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update location set name = '${req.body.locationName}', inHouse = '${req.body.inHouseLocation ? 1 : 0}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * Target Type
   */
   .get('/targetTypes', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTargetTypesQuery = `select * from targetType t`
    connection.query(findTargetTypesQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/targetType', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into targetType (name) values ('${req.body.targetTypeDescription}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/targetType/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from targetType t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {targetType: rows[0]});
    });
    connection.end();
  })
  .post('/targetType/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update targetType set name = '${req.body.targetTypeDescription}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * Target
   */
   .get('/targets', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findTargetsQuery = `select t.id, t.name, t.type, tt.name as typeName, t.location, l.name as locationName, t.person, p.firstName from target t join targettype tt on t.type = tt.id join location l on t.location = l.id left join person p on t.person = p.id`
    connection.query(findTargetsQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/target', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    if (req.body.targetPerson != '') {
      var insert = `insert into target (name, type, location, person) values ('${req.body.targetDescription}','${req.body.targetType}','${req.body.targetLocation}', '${req.body.targetPerson}')`;
    } else {
      var insert = `insert into target (name, type, location) values ('${req.body.targetDescription}','${req.body.targetType}','${req.body.targetLocation}')`;
    }
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/target/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from target t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {target: rows[0]});
    });
    connection.end();
  })
  .post('/target/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update target set name = '${req.body.targetDescription}', type = '${req.body.targetType}', location = '${req.body.targetLocation}', person = ${req.body.targetPerson ? req.body.targetPerson : null} where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * Task Target
   */
   .get('/taskTargets', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select t.id, t.task, tsk.name as taskName, t.target, tgt.name as targetName from taskTarget t join task tsk on t.task = tsk.id join target tgt on t.target = tgt.id`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/taskTarget', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into taskTarget (task, target) values ('${req.body.taskTargetTask}','${req.body.taskTargetTarget}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/taskTarget/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from taskTarget t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {target: rows[0]});
    });
    connection.end();
  })
  .post('/taskTarget/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update taskTarget set task = '${req.body.taskTargetTask}', target = '${req.body.taskTargetTarget}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * Task Value
   */
   .get('/taskValues', (req, res) => {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select t.id, t.task, tsk.name, t.value from taskValue t join task tsk on t.task = tsk.id`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
   .post('/taskValue', function (req, res) {
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into taskValue (task, value) values ('${req.body.taskValueTask}','${req.body.taskValueValue}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    
    res.status(200);
    res.redirect('/management');
  })
  .get('/taskValue/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from taskValue t where t.id = ${id}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.render('pages/edit', {taskValue: rows[0]});
    });
    connection.end();
  })
  .post('/taskValue/:id', (req, res) => {
    let id = req.params.id;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var update = `update taskValue set task = '${req.body.taskValueTask}', value = '${req.body.taskValueValue}' where id = ${id} `;
    connection.query(update, function(err, rows, fields) {
      if (err) throw err;
      console.log("1 record updated");
    });
    connection.end();
    res.status(200);
    res.redirect(`/management`);
  })
  /**
   * Sub Task
   */
   .get('/trackSubTasks', (req, res) => {
    let task = url.parse(req.url, true).query.task;
      res.render('pages/trackSubTasks', {task: task});
    })
   .get('/subTasks', (req, res) => {
    let task = url.parse(req.url, true).query.task;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var findQuery = `select * from subtask st where st.assignedtask = ${task}`
    connection.query(findQuery, function(err, rows, fields) {
      if (err) throw err;
      res.json(rows);
    });
    connection.end();
  })
  .post('/addSubTask', (req, res) => {
    let task = url.parse(req.url, true).query.task;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `insert into subtask (assignedtask, name) values ('${task}','${req.body.description}')`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record inserted");
    });
    connection.end();
    res.status(200);
    res.redirect('/trackSubTasks?task='+task);
  })
  .get('/deleteSubTask', (req, res) => {
    let task = url.parse(req.url, true).query.task;
    let subtask = url.parse(req.url, true).query.subtask;
    var connection = mysql.createConnection(process.env.JAWSDB_URL);
    connection.connect();
    var insert = `delete from subtask where id = ${subtask}`;
    connection.query(insert, function (err, result) {
      if (err) throw err;
      console.log("1 record removed");
    });
    connection.end();
    res.status(200);
    res.redirect('/trackSubTasks?task='+task);
  })

  .listen(PORT, () => console.log(`Listening on ${ PORT }`));

/* Guys, what am I doing. I don't know how to node.js, please send help. */