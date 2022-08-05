const { test, describe, it } = require('test');
const assert = require('assert');
const wahlhalla = require('./index');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const expect = chai.expect;
const supertest = require("supertest");
const should = require("should");

test('synchronous passing test', (t) => {
    // This test passes because it does not throw an exception.
    //Testing a test, hehe.
    assert.strictEqual(1, 1);
});

//var wahlhalla = supertest.agent(process.env.DEV_BASE_URL);

// UNIT test begin
describe("App home page",function(){
    it("should return home page",function(done){

        // calling home page api
        supertest(wahlhalla)
        .get("/")
        .expect("Content-type",/json/)
        .expect(200) 
        .end(function(err,res){
            res.status.should.equal(200);
            should(res.body.error).not.be.ok();
            done();
        });

    });
    
    it("should return home page with a URL Param",function(done){
        supertest(wahlhalla)
        .get("/")
        .query({ byUser: 'true' })
        .expect("Content-type",/json/)
        .expect(200) 
        .end(function(err,res){
            res.status.should.equal(200);
            done();
        });
    });
});

  
describe('/GET assignedTask', () => {
    it('it should GET completed assignedTasks', (done) => {
        chai.request(wahlhalla)
            .get('/assignedTasks')
            .query({ byUser: 'false', complete: '1', type: 'CHORE' })
            .end((err, res) => {
                res.status.should.equal(200);
                should(res.body).be.Array;
                //res.body.length.should.be.eql(0);
            done();
            });
    });
    it('it should GET incomplete assignedTasks', (done) => {
        chai.request(wahlhalla)
            .get('/assignedTasks')
            .query({ byUser: 'false', complete: '0', type: 'CHORE' })
            .end((err, res) => {
                    res.status.should.equal(200);
                    should(res.body).be.Array;
                done();
            });
    });
    it('it should require parameters', (done) => {
    chai.request(wahlhalla)
        .get('/assignedTasks')
        .end((err, res) => {
            res.status.should.equal(400);
            done();
        });
    });
    
});