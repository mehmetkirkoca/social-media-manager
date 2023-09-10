const app = require("../server");
const supertest = require("supertest");
const request = supertest(app.server);

beforeAll(async () => {
    await app.ready();
});

it("send test message to endpoint", async() => {
    const response = await request.post('/').send({message: "test"});
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
});

afterAll(async () => {
    await app.close();
});