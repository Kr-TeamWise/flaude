from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0011_alter_threadmessage_thread_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="executionlog",
            name="sdk_session_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="executionlog",
            name="cost_usd",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="executionlog",
            name="num_turns",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="threadmessage",
            name="sdk_session_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100),
        ),
    ]
