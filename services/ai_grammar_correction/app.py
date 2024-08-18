import pika
import json
from correction import correct_grammar

def callback(ch, method, properties, body):
    print("Received %r" % body)
    data = json.loads(body.decode("utf-8"))
    corrected_text = correct_grammar(data["message"])
    print("Corrected: %s" % corrected_text)
    ch.queue_declare(queue='fixedGrammar', durable=True)
    ch.basic_publish(
        exchange='',
        routing_key='fixedGrammar',
        body=corrected_text,
        properties=pika.BasicProperties(
            delivery_mode=2,  # Make message persistent
        )
    )
            
if __name__ == "__main__":
    credentials = pika.PlainCredentials('username', 'password')
    connection = pika.BlockingConnection(pika.ConnectionParameters('messageBroker', credentials=credentials))
    channel = connection.channel()
    channel.queue_declare(queue='fixGrammar', durable=True)
    channel.basic_consume(queue='fixGrammar', on_message_callback=callback, auto_ack=True)
    print('Waiting for messages. To exit press CTRL+C')
    channel.start_consuming()